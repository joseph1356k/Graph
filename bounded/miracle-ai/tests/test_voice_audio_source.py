"""
La fuente de audio viaja desde el navegador hasta el `start_message` de Soniox.

Lo que se protege aqui es que el microfono normal siga generando EXACTAMENTE la
sesion de antes (`audio_format: "auto"`), que Omi genere PCM crudo declarado, y
que el cliente no pueda colar configuracion arbitraria de Soniox por el body.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from miracle_agent.config import MiracleSettings
from miracle_agent.features.voice.api import create_voice_routes
from miracle_agent.features.voice.contracts import (
    DEFAULT_AUDIO_SOURCE,
    OMI_SOURCE,
    UnsupportedAudioSourceError,
    VoiceStreamSession,
    parse_audio_source,
)
from miracle_agent.features.voice.service import VoiceStreamingError, VoiceStreamingService
from miracle_agent.integrations.soniox import streaming as soniox_streaming
from miracle_agent.integrations.soniox.streaming import SonioxStreamingAdapter

TEMPORARY_KEY = "soniox_temp_key_for_tests"
PERMANENT_KEY = "soniox_PERMANENT_key_never_leaves_the_server"


def _settings(provider: str = "soniox") -> MiracleSettings:
    return MiracleSettings(
        workspace_root=Path("."),
        soniox_api_key=PERMANENT_KEY,
        voice_stt_provider=provider,
        voice_transcription_model="stt-rt-v5",
        voice_transcription_language="es",
    )


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """La emision de la clave temporal es HTTP real: aqui se sustituye."""
    monkeypatch.setattr(
        soniox_streaming,
        "_issue_soniox_temporary_key",
        lambda *, api_key, ttl_seconds: (TEMPORARY_KEY, ttl_seconds),
    )


# --------------------------------------------------------------------------
# Allowlist
# --------------------------------------------------------------------------


class TestParseAudioSource:
    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_ausente_o_vacio_cae_en_el_microfono(self, raw: object) -> None:
        # El proxy de la web manda `{}` desde antes de que Omi existiera.
        assert parse_audio_source(raw) == DEFAULT_AUDIO_SOURCE
        assert parse_audio_source(raw) == "browser_microphone"

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("omi", "omi"),
            ("OMI", "omi"),
            (" omi ", "omi"),
            ("browser_microphone", "browser_microphone"),
        ],
    )
    def test_normaliza_los_valores_de_la_allowlist(self, raw: str, expected: str) -> None:
        assert parse_audio_source(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        ["deepgram", "omi_v2", "pcm_s16le", {"audio_format": "pcm_s16le"}, ["omi"], 20],
    )
    def test_rechaza_todo_lo_demas(self, raw: object) -> None:
        # Incluye el intento de mandar configuracion de Soniox en vez de etiqueta.
        with pytest.raises(UnsupportedAudioSourceError):
            parse_audio_source(raw)


# --------------------------------------------------------------------------
# start_message de Soniox
# --------------------------------------------------------------------------


class TestSonioxStartMessage:
    def test_microfono_normal_conserva_auto(self) -> None:
        session = SonioxStreamingAdapter(_settings()).create_stream_session()
        start = session.start_message
        assert start is not None
        assert start["audio_format"] == "auto"
        # El webm trae su propia cabecera: declarar tasa aqui la contradiria.
        assert "sample_rate" not in start
        assert "num_channels" not in start
        assert session.audio_source == "browser_microphone"

    def test_el_default_explicito_es_identico_al_implicito(self) -> None:
        implicito = SonioxStreamingAdapter(_settings()).create_stream_session()
        explicito = SonioxStreamingAdapter(_settings()).create_stream_session(
            audio_source="browser_microphone"
        )
        assert implicito.start_message == explicito.start_message

    def test_omi_declara_pcm16_16k_mono(self) -> None:
        session = SonioxStreamingAdapter(_settings()).create_stream_session(audio_source=OMI_SOURCE)
        start = session.start_message
        assert start is not None
        assert start["audio_format"] == "pcm_s16le"
        assert start["sample_rate"] == 16000
        assert start["num_channels"] == 1
        assert session.audio_source == "omi"

    def test_omi_no_toca_el_modelo_ni_el_idioma(self) -> None:
        micro = SonioxStreamingAdapter(_settings()).create_stream_session()
        omi = SonioxStreamingAdapter(_settings()).create_stream_session(audio_source=OMI_SOURCE)
        assert omi.model == micro.model == "stt-rt-v5"
        assert omi.start_message["language_hints"] == micro.start_message["language_hints"]
        assert omi.auth_scheme == micro.auth_scheme == "message"

    @pytest.mark.parametrize("source", ["browser_microphone", "omi"])
    def test_solo_viaja_la_clave_temporal(self, source: str) -> None:
        session = SonioxStreamingAdapter(_settings()).create_stream_session(audio_source=source)
        serialized = json.dumps(session.to_dict())
        assert PERMANENT_KEY not in serialized


class TestSonioxDiarizacion:
    """La diarizacion es lo que permite medir el interrogatorio medico-paciente.

    Sin `enable_speaker_diarization` los tokens llegan sin hablante y el portal
    muestra el interrogatorio como "no disponible" (nunca inventa un numero).
    """

    @pytest.mark.parametrize("source", ["browser_microphone", "omi"])
    def test_pide_hablantes_por_defecto(self, source: str) -> None:
        session = SonioxStreamingAdapter(_settings()).create_stream_session(audio_source=source)
        assert session.start_message["enable_speaker_diarization"] is True

    def test_se_puede_apagar_sin_tocar_nada_mas(self) -> None:
        apagada = _settings()
        object.__setattr__(apagada, "voice_stt_diarization", False)
        session = SonioxStreamingAdapter(apagada).create_stream_session()
        assert "enable_speaker_diarization" not in session.start_message
        # Apagarla no cambia el resto de la sesion: mismo modelo y formato.
        encendida = SonioxStreamingAdapter(_settings()).create_stream_session()
        assert session.model == encendida.model
        assert session.start_message["audio_format"] == encendida.start_message["audio_format"]
        assert session.start_message["api_key"] == TEMPORARY_KEY


# --------------------------------------------------------------------------
# Servicio: Omi exige Soniox
# --------------------------------------------------------------------------


class TestServiceGuards:
    def test_omi_con_deepgram_se_rechaza_en_vez_de_degradar(self) -> None:
        class _Provider:
            def create_stream_session(self, *, audio_source: str = DEFAULT_AUDIO_SOURCE):
                raise AssertionError("no deberia llegar al proveedor")

        service = VoiceStreamingService(_settings("deepgram"), provider=_Provider())
        with pytest.raises(VoiceStreamingError) as excinfo:
            service.create_stream_session(audio_source="omi")
        assert excinfo.value.status_code == 503
        assert "Soniox" in str(excinfo.value)

    def test_el_microfono_sigue_funcionando_con_deepgram(self) -> None:
        marker = VoiceStreamSession(
            provider="deepgram",
            access_token="t",
            auth_scheme="bearer",
            expires_in=30,
            websocket_url="wss://example.test",
            model="nova",
            language="es",
            timeslice_ms=250,
            endpointing_ms=300,
        )

        class _Provider:
            def create_stream_session(self, *, audio_source: str = DEFAULT_AUDIO_SOURCE):
                assert audio_source == "browser_microphone"
                return marker

        service = VoiceStreamingService(_settings("deepgram"), provider=_Provider())
        assert service.create_stream_session() is marker


# --------------------------------------------------------------------------
# Ruta HTTP
# --------------------------------------------------------------------------


def _client(provider: str = "soniox") -> TestClient:
    service = VoiceStreamingService.from_settings(_settings(provider))
    return TestClient(Starlette(routes=create_voice_routes(service)))


class TestRoute:
    @pytest.mark.parametrize("body", [None, {}, {"audio_source": None}])
    def test_body_vacio_o_sin_campo_da_la_sesion_de_siempre(self, body: object) -> None:
        # Compatibilidad: es literalmente lo que manda la web hoy en produccion.
        kwargs = {} if body is None else {"json": body}
        response = _client().post("/api/voice/stream-session", **kwargs)
        assert response.status_code == 200
        payload = response.json()
        assert payload["audio_source"] == "browser_microphone"
        assert payload["start_message"]["audio_format"] == "auto"

    def test_omi_llega_hasta_el_start_message(self) -> None:
        response = _client().post("/api/voice/stream-session", json={"audio_source": "omi"})
        assert response.status_code == 200
        start = response.json()["start_message"]
        assert start["audio_format"] == "pcm_s16le"
        assert start["sample_rate"] == 16000
        assert start["num_channels"] == 1

    def test_fuente_desconocida_es_400_y_no_abre_sesion(self) -> None:
        response = _client().post("/api/voice/stream-session", json={"audio_source": "airpods"})
        assert response.status_code == 400
        assert "audio_source" in response.json()["error"]

    def test_no_se_puede_inyectar_configuracion_de_soniox(self) -> None:
        response = _client().post(
            "/api/voice/stream-session",
            json={
                "audio_source": "omi",
                "audio_format": "mp3",
                "sample_rate": 44100,
                "model": "otro",
            },
        )
        assert response.status_code == 200
        start = response.json()["start_message"]
        # Los campos sueltos del cliente se ignoran: manda la etiqueta, no el body.
        assert start["audio_format"] == "pcm_s16le"
        assert start["sample_rate"] == 16000
        assert start["model"] == "stt-rt-v5"
