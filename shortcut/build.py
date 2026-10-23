#!/usr/bin/env python3
"""Build the "Open in Apple Maps" iOS Shortcut.

Flow: share-sheet input (or clipboard) -> first URL -> Expand URL (follows short links)
-> the regex rules in rules.json, which turn everyday Google Maps links into Apple Maps links
on the device -> open that in Apple Maps. Anything the rules leave alone goes to the web
converter with &go=1, which handles every format the library knows. Shared text without a link
(an address, a place name) is searched in Apple Maps.

Usage (macOS): python3 shortcut/build.py   -> writes "site/Open in Apple Maps.shortcut" (signed).
The file name becomes the shortcut's name when someone imports it.
"""
import json
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "Open in Apple Maps.shortcut"
CONVERTER = "https://maps.xuedo.ng/"
RULES = json.loads((ROOT / "shortcut" / "rules.json").read_text())["rules"]
APPLE = "https://maps.apple.com/"
BEGINS_WITH = 8
HAS_ANY_VALUE = 100


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


def new_id():
    return str(uuid.uuid4()).upper()


def build():
    ids = {name: new_id() for name in ["links", "first", "expand", "encode", "text", "open", "web"]}
    group = new_id()
    has_link = new_id()
    # Imported shortcuts don't auto-connect actions, so every input is wired explicitly.
    actions = [
        action(
            "is.workflow.actions.detect.link",
            UUID=ids["links"],
            WFInput=text_with("", {"Type": "ExtensionInput"}),
        ),
        action(
            "is.workflow.actions.conditional",
            GroupingIdentifier=has_link,
            WFControlFlowMode=0,
            WFCondition=HAS_ANY_VALUE,
            WFInput={"Type": "Variable", "Variable": output_of(ids["links"], "URLs")},
        ),
        action(
            "is.workflow.actions.getitemfromlist",
            UUID=ids["first"],
            WFItemSpecifier="First Item",
            WFInput=output_of(ids["links"], "URLs"),
        ),
        action("is.workflow.actions.url.expand", UUID=ids["expand"], URL=text_with("", output(ids["first"], "Item from List"))),
    ]
    link = output(ids["expand"], "Expanded URL")
    for rule in RULES:
        rule_id = new_id()
        actions.append(
            action(
                "is.workflow.actions.text.replace",
                UUID=rule_id,
                CustomOutputName=rule["name"],
                WFInput=text_with("", link),
                WFReplaceTextFind=rule["find"],
                WFReplaceTextReplace=rule["replace"],
                WFReplaceTextRegularExpression=True,
                WFReplaceTextCaseSensitive=False,
            )
        )
        link = output(rule_id, rule["name"])
    actions += [
        # Converted on the device: straight to Apple Maps, no website involved.
        action(
            "is.workflow.actions.conditional",
            GroupingIdentifier=group,
            WFControlFlowMode=0,
            WFCondition=BEGINS_WITH,
            WFConditionalActionString=APPLE,
            WFInput={"Type": "Variable", "Variable": {"WFSerializationType": "WFTextTokenAttachment", "Value": link}},
        ),
        action("is.workflow.actions.openurl", UUID=ids["open"], WFInput=text_with("", link)),
        action("is.workflow.actions.conditional", GroupingIdentifier=group, WFControlFlowMode=1),
        # Everything else: the web converter knows every format the library does.
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
        action("is.workflow.actions.openurl", UUID=ids["web"], WFInput=output_of(ids["text"], "Text")),
        action("is.workflow.actions.conditional", GroupingIdentifier=group, WFControlFlowMode=2),
        # No link at all, e.g. a shared address: search it in Apple Maps. This Maps action is also
        # what lets the shortcut show the Apple Maps icon instead of Safari's.
        action("is.workflow.actions.conditional", GroupingIdentifier=has_link, WFControlFlowMode=1),
        action("is.workflow.actions.searchmaps", WFInput=text_with("", {"Type": "ExtensionInput"})),
        action("is.workflow.actions.conditional", GroupingIdentifier=has_link, WFControlFlowMode=2),
    ]
    return {
        "WFWorkflowClientVersion": "2607.0.1",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59769},  # blue map pin, matches the logo arrow
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
