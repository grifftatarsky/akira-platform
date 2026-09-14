"""Parse the SRD 5.2.1 Rules Glossary into catalog rows.

The chapter is 155 alphabetised entries, each a heading and a definition. Some
carry a bracketed tag — [Condition], [Action], [Hazard], [Area of Effect],
[Attitude] — which is the book's own classification and worth keeping as one.

The fifteen [Condition] entries are the source for the `conditions` table rather
than for the glossary: effects point at conditions by id, so they need rows of
their own, and carrying the book's text in two tables would let the two drift.
"""
import json
import re
import sys

from srdtext import reflow, xml_lines

OUT = 'glossary.json'
GLOSSARY_PAGES = (176, 191)

TAG = re.compile(r'^(?P<name>.+?)\s*\[(?P<tag>[^\]]+)\]$')


def main():
    entries, cur, prev = [], None, None
    for line in xml_lines(*GLOSSARY_PAGES):
        kind, indented, text = line.kind, line.indented, line.text
        if kind == 'chapter' or kind == 'section':
            continue
        if kind == 'head':
            # A wrapped heading, the same as a magic item's name.
            if cur is not None and prev == 'head' and not cur['lines']:
                cur['name'] += ' ' + text
            else:
                cur = {'name': text, 'lines': []}
                entries.append(cur)
        elif cur is not None:
            cur['lines'].append((kind, indented, text))
        prev = kind

    out = []
    for e in entries:
        m = TAG.match(e['name'])
        out.append({
            'name': (m.group('name') if m else e['name']).strip(),
            'category': m.group('tag').upper().replace(' ', '_') if m else None,
            'description': reflow(e['lines']),
        })

    names = [e['name'] for e in out]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    if duplicates:
        print('duplicate entries: %s' % duplicates, file=sys.stderr)
    empty = [e['name'] for e in out if not e['description']]
    if empty:
        print('entries with no definition: %s' % empty, file=sys.stderr)

    json.dump(out, open(OUT, 'w'), indent=1)
    counts = {}
    for e in out:
        counts[e['category'] or 'plain'] = counts.get(e['category'] or 'plain', 0) + 1
    print('%s: %d entries %s' % (OUT, len(out), counts), file=sys.stderr)


if __name__ == '__main__':
    main()
