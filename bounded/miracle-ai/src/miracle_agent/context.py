from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MiracleContext:
    workspace_root: Path
    memory_root: Path
    features_root: Path
    adrs_root: Path
    knowledge_root: Path
    product_workspace_root: Path

    @classmethod
    def from_workspace(cls, workspace_root: Path) -> "MiracleContext":
        root = workspace_root.resolve()
        workspaces_root = root / "workspaces"
        product_workspace_root = workspaces_root / "miracle"
        memory_root_override = os.getenv("MIRACLE_MEMORY_ROOT", "").strip()
        memory_root = Path(memory_root_override).resolve() if memory_root_override else (product_workspace_root / "memory")
        return cls(
            workspace_root=root,
            memory_root=memory_root,
            features_root=root / "docs" / "features",
            adrs_root=root / "docs" / "adrs",
            knowledge_root=product_workspace_root / "knowledge",
            product_workspace_root=product_workspace_root,
        )

    def ensure_layout(self) -> None:
        for path in (
            self.product_workspace_root,
            self.memory_root,
            self.memory_root / "notes",
            self.memory_root / "decisions",
            self.features_root,
            self.adrs_root,
            self.knowledge_root,
        ):
            path.mkdir(parents=True, exist_ok=True)
