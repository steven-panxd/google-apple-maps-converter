#!/usr/bin/env python3
"""Build the "Open in Apple Maps" iOS Shortcut.

What the shortcut does with what it's given (share sheet input, or the clipboard):

    link in it?  no  -> search the text in Apple Maps (a shared address, a place name)
                 yes -> take the first link, as plain text
                        short link (goo.gl)? -> ask Google where it points; full links stay on the phone
                        run the regex rules in rules.json
                        maps://...?    yes -> open it in the Maps app
                                       no  -> open the web converter, which knows every format

Usage (macOS): python3 shortcut/build.py   -> writes "site/Open in Apple Maps.shortcut" (signed).
The file name becomes the shortcut's name when someone imports it.
"""
import json
import plistlib
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "Open in Apple Maps.shortcut"
RULES_FILE = ROOT / "shortcut" / "rules.json"
CONVERTER = "https://maps.xuedo.ng/"
MAPS_APP = "maps://"

# Shortcuts' condition codes.
BEGINS_WITH = 8
HAS_ANY_VALUE = 100

SHORTCUT_INPUT = {"Type": "ExtensionInput"}
LINK_PATTERN = r"https?://[^\s<>\"]+"
SHORT_LINK_PATTERN = r"^https?://(?:maps\.app\.goo\.gl|goo\.gl/maps)/"


def load_rules():
    """rules.json, with each {part} in a pattern filled in."""
    data = json.loads(RULES_FILE.read_text())

    def expand(pattern):
        while True:
            filled = re.sub(r"\{([a-z_]+)\}", lambda m: data["parts"][m.group(1)], pattern)
            if filled == pattern:
                return pattern
            pattern = filled

    return [{**rule, "find": expand(rule["find"])} for rule in data["rules"]]


# --- Shortcut file format ----------------------------------------------------------------------
# Imported shortcuts don't connect actions on their own, so every input names its source.


def text(variable, before="", after=""):
    """A text parameter holding a variable (a U+FFFC placeholder at its UTF-16 offset)."""
    offset = len(before.encode("utf-16-le")) // 2
    return {
        "WFSerializationType": "WFTextTokenString",
        "Value": {"string": f"{before}￼{after}", "attachmentsByRange": {f"{{{offset}, 1}}": variable}},
    }


def value(variable):
    """A list or content parameter holding a single variable."""
    return {"WFSerializationType": "WFTextTokenAttachment", "Value": variable}


def new_id():
    return str(uuid.uuid4()).upper()


class Shortcut:
    def __init__(self):
        self.actions = []

    def add(self, name, output=None, **params):
        """Append an action; returns a reference to its output when `output` names it."""
        action_id = new_id()
        params["UUID"] = action_id
        if output:
            params.setdefault("CustomOutputName", output)
        self.actions.append({"WFWorkflowActionIdentifier": f"is.workflow.actions.{name}", "WFWorkflowActionParameters": params})
        return {"Type": "ActionOutput", "OutputUUID": action_id, "OutputName": output} if output else None

    def if_(self, variable, condition, compare_to=None):
        group = new_id()
        params = {"WFInput": {"Type": "Variable", "Variable": value(variable)}, "WFCondition": condition}
        if compare_to is not None:
            params["WFConditionalActionString"] = compare_to
        self.add("conditional", GroupingIdentifier=group, WFControlFlowMode=0, **params)
        return group

    def otherwise(self, group):
        self.add("conditional", GroupingIdentifier=group, WFControlFlowMode=1)

    def end_if(self, group):
        """Ends the block; returns its result (the last output of whichever branch ran)."""
        return self.add("conditional", "If Result", GroupingIdentifier=group, WFControlFlowMode=2)


# --- What the shortcut does --------------------------------------------------------------------


def where_short_links_point(s, link):
    """Only short links need Google to say where they point, so full links never leave the phone."""
    is_short = s.add("text.match", "Short Link", WFMatchTextPattern=SHORT_LINK_PATTERN, text=text(link))
    short = s.if_(is_short, HAS_ANY_VALUE)
    s.add("url.expand", "Expanded URL", URL=text(link))
    s.otherwise(short)
    s.add("gettext", "Link", WFTextActionText=text(link))
    return s.end_if(short)


def convert_on_device(s, link):
    for rule in load_rules():
        link = s.add(
            "text.replace",
            rule["name"],
            WFInput=text(link),
            WFReplaceTextFind=rule["find"],
            WFReplaceTextReplace=rule["replace"],
            WFReplaceTextRegularExpression=True,
            WFReplaceTextCaseSensitive=False,
        )
    return link


def open_web_converter(s, link):
    encoded = s.add("urlencode", "URL Encoded Text", WFEncodeMode="Encode", WFInput=text(link))
    url = s.add("gettext", "Converter URL", WFTextActionText=text(encoded, before=f"{CONVERTER}?url=", after="&go=1"))
    s.add("openurl", WFInput=value(url))


def build():
    s = Shortcut()
    # Pull links out of the input as plain text. "Get URLs from Input" returns URL items that some
    # apps (the Google Maps app) back with a web page, and those turn into the page's text when used.
    links = s.add("text.match", "Links", WFMatchTextPattern=LINK_PATTERN, text=text(SHORTCUT_INPUT))

    has_link = s.if_(links, HAS_ANY_VALUE)
    first = s.add("getitemfromlist", "First Link", WFItemSpecifier="First Item", WFInput=value(links))
    link = where_short_links_point(s, first)
    converted = convert_on_device(s, link)
    on_device = s.if_(converted, BEGINS_WITH, MAPS_APP)
    s.add("openurl", WFInput=text(converted))
    s.otherwise(on_device)
    open_web_converter(s, link)
    s.end_if(on_device)

    s.otherwise(has_link)
    # Also gives the shortcut actions from two apps, which keeps iOS from showing Safari's icon
    # in place of the shortcut's own when it's installed from iCloud.
    s.add("searchmaps", WFInput=text(SHORTCUT_INPUT))
    s.end_if(has_link)

    # Return nothing, or iOS asks whether the shortcut may "output" the link.
    s.add("nothing")

    return {
        "WFWorkflowClientVersion": "2607.0.1",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59769},  # blue map pin
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFStringContentItem", "WFSafariWebPageContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorGetClipboard", "Parameters": {}},
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": s.actions,
    }


def main():
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / OUT.name
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
