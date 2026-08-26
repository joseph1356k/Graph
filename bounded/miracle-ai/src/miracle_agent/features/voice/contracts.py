from __future__ import annotations

from dataclasses import asdict, dataclass, field

# ---------------------------------------------------------------------------
# Fuente de audio
# ---------------------------------------------------------------------------
# El navegador puede abrir el stream desde el microfono normal (MediaRecorder,
# contenedor webm/opus) o desde un Omi por Web Bluetooth (PCM crudo ya
# decodificado). Soniox necesita saber cual de las dos es ANTES de recibir el
# primer byte: el contenedor no se autodetecta a partir de PCM sin cabecera.
#
# Es una ALLOWLIST cerrada a proposito. El cliente elige una ETIQUETA, nunca
# manda configuracion de Soniox: si mandara `audio_format`/`sample_rate` libres,
# el navegador podria pedirle al backend cualquier cosa (y facturarla). Aqui la
# etiqueta se traduce a configuracion en el adaptador, server-side.
BROWSER_MICROPHONE_SOURCE = "browser_microphone"
OMI_SOURCE = "omi"
DEFAULT_AUDIO_SOURCE = BROWSER_MICROPHONE_SOURCE
SUPPORTED_AUDIO_SOURCES = frozenset({BROWSER_MICROPHONE_SOURCE, OMI_SOURCE})


class UnsupportedAudioSourceError(ValueError):
    """La peticion pidio una fuente que no esta en la allowlist."""

    def __init__(self, raw: object) -> None:
        self.raw = raw
        supported = ", ".join(sorted(SUPPORTED_AUDIO_SOURCES))
        super().__init__(f"Unsupported audio_source. Supported values: {supported}")


def parse_audio_source(raw: object) -> str:
    """
    Normaliza el `audio_source` del body.

    Ausente, null o cadena vacia -> microfono del navegador. Ese default es lo
    que mantiene vivo el flujo actual: la web hoy manda `{}` y debe seguir
    recibiendo exactamente la misma sesion que antes de que existiera Omi.
    """
    if raw is None:
        return DEFAULT_AUDIO_SOURCE
    if not isinstance(raw, str):
        raise UnsupportedAudioSourceError(raw)
    normalized = raw.strip().lower()
    if not normalized:
        return DEFAULT_AUDIO_SOURCE
    if normalized not in SUPPORTED_AUDIO_SOURCES:
        raise UnsupportedAudioSourceError(raw)
    return normalized


@dataclass(frozen=True)
class VoiceStreamSession:
    provider: str
    access_token: str
    auth_scheme: str
    expires_in: int
    websocket_url: str
    model: str
    language: str
    timeslice_ms: int
    endpointing_ms: int
    # Providers that authenticate/configure via the first WebSocket frame
    # (e.g. Soniox: auth_scheme="message") carry the JSON config the browser must
    # send once the socket opens. Deepgram leaves this empty and authenticates via
    # the WebSocket subprotocol instead.
    start_message: dict[str, object] | None = field(default=None)
    # Eco de la fuente con la que se construyo la sesion. El cliente lo usa para
    # confirmar que el backend entendio lo mismo que el: si pidio Omi y le
    # vuelve "browser_microphone", mandaria PCM crudo a un stream configurado
    # para webm y la consulta saldria en blanco.
    audio_source: str = DEFAULT_AUDIO_SOURCE

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
