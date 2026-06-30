from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher, unified_diff
from hashlib import sha1


def _trim_preview(value: str, limit: int = 160) -> str:
    clean = " ".join(value.split())
    if len(clean) <= limit:
        return clean
    return clean[: limit - 1].rstrip() + "..."


def _first_meaningful_line(value: str) -> str:
    for line in value.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def _starts_with_heading(markdown: str) -> bool:
    first_line = _first_meaningful_line(markdown)
    if not first_line.startswith("#"):
        return False
    level = 0
    for char in first_line:
        if char == "#":
            level += 1
        else:
            break
    return 1 <= level <= 6 and len(first_line) > level and first_line[level] == " "


def _looks_like_expansion(before: str, after: str) -> bool:
    before_clean = before.strip()
    after_clean = after.strip()
    if not before_clean or not after_clean:
        return False
    if after_clean.startswith(before_clean) and len(after_clean) > len(before_clean):
        return True
    return before_clean in after_clean and len(after_clean) > len(before_clean) + 20


def _extract_headings(markdown: str) -> list[tuple[int, str]]:
    headings: list[tuple[int, str]] = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        level = 0
        for char in stripped:
            if char == "#":
                level += 1
            else:
                break
        if 1 <= level <= 6 and len(stripped) > level and stripped[level] == " ":
            headings.append((level, stripped[level + 1 :].strip()))
    return headings


def _classify_block_change(
    tag: str,
    before_blocks: list["BlockContext"],
    after_blocks: list["BlockContext"],
) -> tuple[str, str]:
    if tag == "insert":
        if any(_starts_with_heading(block.markdown) for block in after_blocks):
            return "new_section", "Sección nueva"
        return "new_block", "Bloque agregado"

    if tag == "delete":
        if any(_starts_with_heading(block.markdown) for block in before_blocks):
            return "removed_section", "Sección eliminada"
        return "removed_block", "Bloque eliminado"

    if len(before_blocks) == 1 and len(after_blocks) == 1:
        before_block = before_blocks[0]
        after_block = after_blocks[0]
        before_headings = _extract_headings(before_block.markdown)
        after_headings = _extract_headings(after_block.markdown)
        if before_headings and after_headings and before_headings != after_headings:
            return "renamed_section", "Sección renombrada"
        if _looks_like_expansion(before_block.markdown, after_block.markdown):
            return "expanded_block", "Bloque expandido"

    if len(after_blocks) > len(before_blocks) and any(_starts_with_heading(block.markdown) for block in after_blocks):
        return "new_section", "Sección nueva"

    return "edited_block", "Bloque editado"


@dataclass(frozen=True)
class BlockContext:
    block_id: str
    index: int
    start: int
    end: int
    markdown: str
    preview: str
    heading_path: list[str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class RecentChange:
    kind: str
    summary: str
    inserted_text: str
    removed_text: str
    changed_range: dict[str, int]
    timestamp: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ContextPacket:
    note: dict[str, object]
    note_blocks: list[dict[str, object]]
    active_block: dict[str, object]
    previous_block: dict[str, object] | None
    next_block: dict[str, object] | None
    recent_change: dict[str, object]
    session_diff: dict[str, object]
    selection: dict[str, int]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class SessionDiff:
    has_changes: bool
    summary: str
    unified_diff: str
    changed_blocks: list[dict[str, object]]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def build_note_blocks(content: str) -> list[dict[str, object]]:
    return [block.to_dict() for block in annotate_heading_paths(split_markdown_blocks(content))]


def split_markdown_blocks(content: str) -> list[BlockContext]:
    if content == "":
        return [BlockContext("block-empty", 0, 0, 0, "", "", [])]

    blocks: list[BlockContext] = []
    lines = content.splitlines(keepends=True)
    current_start = 0
    current_lines: list[str] = []
    position = 0

    def flush_block(start: int, end: int, collected_lines: list[str]) -> None:
        raw = "".join(collected_lines).rstrip("\n")
        preview_source = _first_meaningful_line(raw)
        block_id = f"block-{len(blocks) + 1}-{sha1(f'{start}:{raw}'.encode('utf-8')).hexdigest()[:8]}"
        blocks.append(
            BlockContext(
                block_id=block_id,
                index=len(blocks),
                start=start,
                end=end,
                markdown=raw,
                preview=_trim_preview(preview_source),
                heading_path=[],
            )
        )

    for line in lines:
        if line.strip() == "":
            if current_lines:
                flush_block(current_start, position, current_lines)
                current_lines = []
            current_start = position + len(line)
        else:
            if not current_lines:
                current_start = position
            current_lines.append(line)
        position += len(line)

    if current_lines:
        flush_block(current_start, len(content), current_lines)

    if blocks:
        return blocks
    return [BlockContext("block-empty", 0, 0, len(content), content, _trim_preview(_first_meaningful_line(content)), [])]


def annotate_heading_paths(blocks: list[BlockContext]) -> list[BlockContext]:
    stack: list[str] = []
    annotated: list[BlockContext] = []
    for block in blocks:
        headings = _extract_headings(block.markdown)
        if headings:
            for level, text in headings:
                stack = stack[: level - 1]
                stack.append(text)
            heading_path = stack.copy()
        else:
            heading_path = stack.copy()
        annotated.append(
            BlockContext(
                block_id=block.block_id,
                index=block.index,
                start=block.start,
                end=block.end,
                markdown=block.markdown,
                preview=block.preview,
                heading_path=heading_path,
            )
        )
    return annotated


def resolve_active_block(content: str, cursor_start: int, cursor_end: int) -> tuple[BlockContext, BlockContext | None, BlockContext | None]:
    blocks = annotate_heading_paths(split_markdown_blocks(content))
    if not blocks:
        empty = BlockContext("block-empty", 0, 0, 0, "", "", [])
        return empty, None, None

    anchor = min(max(cursor_start, 0), len(content))
    for index, block in enumerate(blocks):
        if block.start <= anchor <= max(block.end, block.start):
            previous_block = blocks[index - 1] if index > 0 else None
            next_block = blocks[index + 1] if index + 1 < len(blocks) else None
            return block, previous_block, next_block

    block = blocks[-1]
    previous_block = blocks[-2] if len(blocks) > 1 else None
    return block, previous_block, None


def detect_recent_change(previous_content: str, current_content: str) -> RecentChange:
    if previous_content == current_content:
        return RecentChange(
            kind="none",
            summary="Sin cambios recientes",
            inserted_text="",
            removed_text="",
            changed_range={"start": 0, "end": 0},
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    matcher = SequenceMatcher(a=previous_content, b=current_content)
    changed_ops = [opcode for opcode in matcher.get_opcodes() if opcode[0] != "equal"]
    if not changed_ops:
        return RecentChange(
            kind="none",
            summary="Sin cambios recientes",
            inserted_text="",
            removed_text="",
            changed_range={"start": 0, "end": 0},
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    kind, i1, i2, j1, j2 = changed_ops[-1]
    inserted = current_content[j1:j2].strip()
    removed = previous_content[i1:i2].strip()

    if kind == "insert":
        summary = f"Insertado: {_trim_preview(inserted or current_content[j1:j2])}"
    elif kind == "delete":
        summary = f"Eliminado: {_trim_preview(removed or previous_content[i1:i2])}"
    else:
        summary = f"Actualizado: {_trim_preview(inserted or removed or current_content[j1:j2])}"

    return RecentChange(
        kind=kind,
        summary=summary,
        inserted_text=inserted,
        removed_text=removed,
        changed_range={"start": j1, "end": j2},
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def build_session_diff(baseline_content: str, current_content: str) -> SessionDiff:
    if baseline_content == current_content:
        return SessionDiff(False, "Sin cambios contra la base de sesión", "", [])

    diff_lines = list(
        unified_diff(
            baseline_content.splitlines(),
            current_content.splitlines(),
            fromfile="session-base",
            tofile="current",
            lineterm="",
        )
    )
    baseline_blocks = annotate_heading_paths(split_markdown_blocks(baseline_content))
    current_blocks = annotate_heading_paths(split_markdown_blocks(current_content))
    matcher = SequenceMatcher(a=[block.markdown for block in baseline_blocks], b=[block.markdown for block in current_blocks])

    changed_blocks: list[dict[str, object]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        before_blocks = baseline_blocks[i1:i2]
        after_blocks = current_blocks[j1:j2]
        semantic_kind, label = _classify_block_change(tag, before_blocks, after_blocks)
        changed_blocks.append(
            {
                "kind": tag,
                "semantic_kind": semantic_kind,
                "label": label,
                "before_count": len(before_blocks),
                "after_count": len(after_blocks),
                "before_preview": [_trim_preview(block.preview or block.markdown) for block in before_blocks],
                "after_preview": [_trim_preview(block.preview or block.markdown) for block in after_blocks],
                "before_heading_paths": [block.heading_path for block in before_blocks],
                "after_heading_paths": [block.heading_path for block in after_blocks],
            }
        )

    summary = f"{len(changed_blocks)} cambio(s) de bloque respecto a la base de sesión"
    return SessionDiff(True, summary, "\n".join(diff_lines), changed_blocks)


def build_history_entry(
    *,
    note_path: str | None,
    note_title: str,
    previous_content: str,
    current_content: str,
    cursor_start: int,
    cursor_end: int,
) -> dict[str, object]:
    active_block, _, _ = resolve_active_block(current_content, cursor_start, cursor_end)
    recent_change = detect_recent_change(previous_content, current_content)
    semantic_kind, semantic_label = _classify_block_change(
        recent_change.kind,
        annotate_heading_paths(split_markdown_blocks(previous_content)),
        annotate_heading_paths(split_markdown_blocks(current_content)),
    )
    return {
        "timestamp": recent_change.timestamp,
        "note_path": note_path,
        "note_title": note_title,
        "block_id": active_block.block_id,
        "block_preview": active_block.preview or "Sin bloque",
        "block_markdown": active_block.markdown,
        "heading_path": active_block.heading_path,
        "summary": recent_change.summary,
        "kind": recent_change.kind,
        "semantic_kind": semantic_kind,
        "semantic_label": semantic_label,
        "changed_range": recent_change.changed_range,
        "inserted_text": recent_change.inserted_text,
        "removed_text": recent_change.removed_text,
    }


def build_context_packet(
    *,
    note_path: str | None,
    note_title: str,
    content: str,
    cursor_start: int,
    cursor_end: int,
    previous_content: str,
    baseline_content: str,
) -> ContextPacket:
    active_block, previous_block, next_block = resolve_active_block(content, cursor_start, cursor_end)
    note_blocks = build_note_blocks(content)
    recent_change = detect_recent_change(previous_content, content)
    session_diff = build_session_diff(baseline_content, content)
    note_id = (note_path or note_title or "untitled").replace("/", ":")

    return ContextPacket(
        note={"id": note_id, "path": note_path, "title": note_title},
        note_blocks=note_blocks,
        active_block=active_block.to_dict(),
        previous_block=previous_block.to_dict() if previous_block else None,
        next_block=next_block.to_dict() if next_block else None,
        recent_change=recent_change.to_dict(),
        session_diff=session_diff.to_dict(),
        selection={"start": cursor_start, "end": cursor_end},
    )
