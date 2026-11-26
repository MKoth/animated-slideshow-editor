from pathlib import Path

from app.export_storage import project_export_dir


def test_project_export_dir_uses_category_order_name_project_order_and_id(tmp_path: Path) -> None:
    result = project_export_dir(
        tmp_path,
        "project-abc",
        category_order=1,
        category_name="Language Lessons",
        project_order=9,
        project_name="Subjunctive Verbs",
    )

    assert result.name == "02-Language-Lessons__10-Subjunctive-Verbs--project-abc"


def test_project_export_dir_renames_existing_id_only_directory(tmp_path: Path) -> None:
    old = tmp_path / "project-abc"
    old.mkdir()
    (old / "joined.mp4").write_bytes(b"video")

    result = project_export_dir(
        tmp_path,
        "project-abc",
        category_name="Uncategorized",
        project_order=0,
        project_name="Lesson",
    )

    assert result.name == "00-Uncategorized__01-Lesson--project-abc"
    assert (result / "joined.mp4").read_bytes() == b"video"
