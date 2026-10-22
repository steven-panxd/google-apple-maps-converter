#!/usr/bin/env python3
"""Build the "Open in Apple Maps" iOS Shortcut.

Flow: share-sheet input (or clipboard) -> first URL -> Expand URL (follows short links)
-> URL-encode -> open the web converter with &go=1, which redirects to Apple Maps.

Usage (macOS): python3 shortcut/build.py   -> writes site/Open-in-Apple-Maps.shortcut (signed)
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "Open-in-Apple-Maps.shortcut"
CONVERTER = "https://steven-panxd.github.io/google-apple-maps-converter/"


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": params}


def text_with_output(before, output_uuid, output_name, after):
    # Shortcuts marks an inline variable with U+FFFC at a UTF-16 offset.
    offset = len(before.encode("utf-16-le")) // 2
    return {
        "WFSerializationType": "WFTextTokenString",
        "Value": {
            "string": f"{before}￼{after}",
            "attachmentsByRange": {
                f"{{{offset}, 1}}": {"Type": "ActionOutput", "OutputUUID": output_uuid, "OutputName": output_name}
            },
        },
    }


def build():
    encode_id = str(uuid.uuid4()).upper()
    # Each action without an explicit input receives the previous action's output.
    actions = [
        action("is.workflow.actions.detect.link", UUID=str(uuid.uuid4()).upper()),
        action("is.workflow.actions.getitemfromlist", UUID=str(uuid.uuid4()).upper(), WFItemSpecifier="First Item"),
        action("is.workflow.actions.url.expand", UUID=str(uuid.uuid4()).upper()),
        action("is.workflow.actions.urlencode", UUID=encode_id, WFEncodeMode="Encode"),
        action(
            "is.workflow.actions.gettext",
            UUID=str(uuid.uuid4()).upper(),
            WFTextActionText=text_with_output(f"{CONVERTER}?url=", encode_id, "URL Encoded Text", "&go=1"),
        ),
        action("is.workflow.actions.openurl", UUID=str(uuid.uuid4()).upper()),
    ]
    return {
        "WFWorkflowClientVersion": "2607.0.1",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59446},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFStringContentItem", "WFSafariWebPageContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorGetClipboard", "Parameters": {}},
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions,
    }


def main():
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / "Open in Apple Maps.shortcut"
        unsigned.write_bytes(plistlib.dumps(build(), fmt=plistlib.FMT_BINARY))
        result = subprocess.run(
            ["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(OUT)],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        sys.exit(f"shortcuts sign failed: {result.stderr.strip()}")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
