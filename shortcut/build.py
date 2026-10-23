#!/usr/bin/env python3
"""Build the "Open in Apple Maps" iOS Shortcut.

Flow: share-sheet input (or clipboard) -> first URL -> Expand URL (follows short links)
-> URL-encode -> open the web converter with &go=1, which redirects to Apple Maps.

Usage (macOS): python3 shortcut/build.py   -> writes "site/Open in Apple Maps.shortcut" (signed).
The file name becomes the shortcut's name when someone imports it.
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "Open in Apple Maps.shortcut"
CONVERTER = "https://maps.xuedo.ng/"


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": params}


def text_with(before, attachment, after=""):
    # Text parameters hold variables as U+FFFC placeholders at a UTF-16 offset.
    offset = len(before.encode("utf-16-le")) // 2
    return {
        "WFSerializationType": "WFTextTokenString",
        "Value": {"string": f"{before}\ufffc{after}", "attachmentsByRange": {f"{{{offset}, 1}}": attachment}},
    }


def output(output_uuid, output_name):
    return {"Type": "ActionOutput", "OutputUUID": output_uuid, "OutputName": output_name}


def output_of(output_uuid, output_name):
    # List and content parameters hold a single variable instead of text.
    return {"WFSerializationType": "WFTextTokenAttachment", "Value": output(output_uuid, output_name)}


def build():
    ids = {name: str(uuid.uuid4()).upper() for name in ["links", "first", "expand", "encode", "text", "open"]}
    # Imported shortcuts don't auto-connect actions, so every input is wired explicitly.
    actions = [
        action(
            "is.workflow.actions.detect.link",
            UUID=ids["links"],
            WFInput=text_with("", {"Type": "ExtensionInput"}),
        ),
        action(
            "is.workflow.actions.getitemfromlist",
            UUID=ids["first"],
            WFItemSpecifier="First Item",
            WFInput=output_of(ids["links"], "URLs"),
        ),
        action("is.workflow.actions.url.expand", UUID=ids["expand"], URL=text_with("", output(ids["first"], "Item from List"))),
        action(
            "is.workflow.actions.urlencode",
            UUID=ids["encode"],
            WFEncodeMode="Encode",
            WFInput=text_with("", output(ids["expand"], "Expanded URL")),
        ),
        action(
            "is.workflow.actions.gettext",
            UUID=ids["text"],
            WFTextActionText=text_with(f"{CONVERTER}?url=", output(ids["encode"], "URL Encoded Text"), "&go=1"),
        ),
        action("is.workflow.actions.openurl", UUID=ids["open"], WFInput=output_of(ids["text"], "Text")),
    ]
    return {
        "WFWorkflowClientVersion": "2607.0.1",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59769},  # green map pin
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
