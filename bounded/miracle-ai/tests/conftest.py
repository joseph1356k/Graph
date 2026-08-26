"""
Deja `src/` en el path: el paquete se instala con hatchling en despliegue, pero
las pruebas corren contra el arbol de trabajo sin instalar nada.
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
