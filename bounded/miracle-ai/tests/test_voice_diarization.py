"""
La sesion de Soniox pide hablantes.

Sin `enable_speaker_diarization` los tokens llegan sin saber quien habla, y el
tiempo de interrogatorio medico-paciente no se puede medir: el portal lo
muestra como "no disponible" en vez de estimarlo. Esto fija que se pida por
defecto, que se pueda apagar, y que apagarlo no toque nada mas de la sesion.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from miracle_agent.config import MiracleSettings
from miracle_agent.integrations.soniox import streaming as soniox_streaming
from miracle_agent.integrations.soniox.streaming import SonioxStreamingAdapter

TEMPORARY_KEY = "soniox_temp_key_for_tests"
PERMANENT_KEY = "soniox_PERMANENT_key_never_leaves_the_server"


def _settings() -> MiracleSettings:
    return MiracleSettings(
        workspace_root=Path("."),
        soniox_api_key=PERMANENT_KEY,
        voice_stt_provider="soniox",
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


class TestSonioxDiarizacion:
    def test_pide_hablantes_por_defecto(self) -> None:
        session = SonioxStreamingAdapter(_settings()).create_stream_session()
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

    def test_la_clave_permanente_nunca_viaja(self) -> None:
        session = SonioxStreamingAdapter(_settings()).create_stream_session()
        assert PERMANENT_KEY not in json.dumps(session.to_dict())
