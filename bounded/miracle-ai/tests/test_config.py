"""Prueba mínima real para que `pytest` (testpaths = ["tests"]) tenga algo que
correr. `_parse_custom_terms_env` es la función pura más simple del módulo:
parsea vocabulario custom de STT desde una variable de entorno multi-línea con
comas opcionales.
"""
from miracle_agent.config import _parse_custom_terms_env


def test_parse_custom_terms_env_vacio():
    assert _parse_custom_terms_env("") == ()
    assert _parse_custom_terms_env(None) == ()


def test_parse_custom_terms_env_lineas():
    raw = "hipertension\ndiabetes mellitus\n"
    assert _parse_custom_terms_env(raw) == ("hipertension", "diabetes mellitus")


def test_parse_custom_terms_env_comas_y_espacios():
    raw = "hipertension, diabetes ,  \n\n cefalea"
    assert _parse_custom_terms_env(raw) == ("hipertension", "diabetes", "cefalea")


def test_parse_custom_terms_env_retorno_normalizado_crlf():
    raw = "termino uno\r\ntermino dos"
    assert _parse_custom_terms_env(raw) == ("termino uno", "termino dos")
