from app.ai.ingestion import chunk_sections, normalize_text


def test_chunk_sections_preserves_sections_and_overlap() -> None:
    text = "Premier paragraphe assez long. " * 20 + "\n\n" + "Deuxième paragraphe. " * 20
    chunks = chunk_sections([("page-1", text)], target_chars=500, overlap_chars=60)

    assert len(chunks) >= 2
    assert {section for section, _ in chunks} == {"page-1"}
    assert all(chunk.strip() == chunk for _, chunk in chunks)
    assert all(len(chunk) <= 620 for _, chunk in chunks)


def test_normalize_text_removes_control_spacing() -> None:
    assert normalize_text("Titre\x00\n\n\n  Corps\t  texte") == "Titre\n\nCorps texte"
