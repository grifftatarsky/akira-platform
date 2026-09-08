"""Parse the catalog-shaped parts of the SRD 5.2.1 Gameplay Toolbox.

Most of the chapter is procedure — how to budget an encounter, how to build a
background — which is not catalog content and is not imported. Four things in it
are entries a DM looks up:

* 14 sample poisons, priced per dose, which are items;
* 8 example traps, each with a severity, a trigger and a duration;
* 3 magical contagions;
* 9 environmental effects.

The last two are named rules with prose, so they join the glossary under
categories of their own rather than getting a table apiece for three rows.
"""
import json
import re
import sys

from srdtext import money, reflow, xml_lines

OUT = 'toolbox.json'
TOOLBOX_PAGES = (193, 202)

PRICED = re.compile(r'^(?P<name>.+?)\s*\((?P<cost>[\d,]+\s*(?:CP|SP|EP|GP|PP))\)$')
# Rolling Stone prints two: "Deadly Trap (Levels 11-16) or Nuisance Trap
# (Levels 17-20)". The first is the primary; the printed line keeps both.
SEVERITY = re.compile(r'(?P<severity>Nuisance|Bane|Deadly) Trap \(Levels? (?P<levels>[\d-]+)')
POISON_TYPE = re.compile(r'^(Contact|Ingested|Inhaled|Injury) Poison$')
LABEL = re.compile(r'^(Trigger|Duration):\s*(.+)$')

ENVIRONMENT = {'Deep Water', 'Extreme Cold', 'Extreme Heat', 'Frigid Water',
               'Heavy Precipitation', 'High Altitude', 'Slippery Ice', 'Strong Wind',
               'Thin Ice'}


def main():
    poisons, traps, contagions, environment = [], [], [], []
    section, cur, kind, label = None, None, None, None

    for line in xml_lines(*TOOLBOX_PAGES):
        if line.kind in ('chapter', 'section'):
            label = None
            if line.text in ENVIRONMENT:
                cur = {'name': line.text, 'lines': []}
                kind = 'environment'
                environment.append(cur)
            else:
                section, cur, kind = line.text, None, None
            continue
        if line.kind == 'head':
            if line.text == 'Example Contagions':
                # A head, not a section, but it opens one all the same.
                section, cur, kind = 'Example Contagions', None, None
                continue
            cur, kind = None, None
            if section == 'Sample Poisons':
                m = PRICED.match(line.text)
                if m:
                    cur = {'name': m.group('name').strip(), 'costGp': money(m.group('cost')),
                           'type': None, 'lines': []}
                    kind = 'poison'
                    poisons.append(cur)
            elif section == 'Example Traps':
                cur = {'name': line.text, 'severity': None, 'levels': None,
                       'severityText': None, 'trigger': None, 'duration': None, 'lines': []}
                kind = 'trap'
                traps.append(cur)
            elif section == 'Example Contagions' or line.text == 'Example Contagions':
                cur = {'name': line.text, 'lines': []}
                kind = 'contagion'
                contagions.append(cur)
            continue
        if cur is None:
            continue
        if kind == 'poison' and cur['type'] is None:
            m = POISON_TYPE.match(line.text)
            if m:
                cur['type'] = m.group(1).upper()
                continue
        if kind == 'trap':
            if cur['severity'] is None:
                m = SEVERITY.search(line.text)
                if m:
                    cur['severity'] = m.group('severity').upper()
                    cur['levels'] = m.group('levels')
                    cur['severityText'] = line.text
                    label = 'severityText'  # it can wrap: "... or Nuisance Trap (Levels" / "17-20)"
                    continue
            m = LABEL.match(line.text)
            if m:
                label = m.group(1).lower()
                cur[label] = m.group(2)
                continue
            # A label's value can wrap. Prose starts a sentence, so a line
            # opening in lowercase is still the label above it.
            if label and (line.text[:1].islower() or line.text[:1].isdigit()):
                cur[label] += ' ' + line.text
                continue
            label = None
        cur['lines'].append((line.kind, line.indented, line.text))

    out = {
        'poisons': [{'name': p['name'], 'costGp': p['costGp'], 'poisonType': p['type'],
                     'description': reflow(p['lines'])} for p in poisons],
        'traps': [{'name': t['name'], 'severity': t['severity'], 'levelBand': t['levels'],
                   'severityText': t.get('severityText'),
                   'trigger': t['trigger'], 'duration': t['duration'],
                   'description': reflow(t['lines'])} for t in traps],
        'contagions': [{'name': c['name'], 'description': reflow(c['lines'])}
                       for c in contagions],
        'environment': [{'name': e['name'], 'description': reflow(e['lines'])}
                        for e in environment],
    }

    for p in out['poisons']:
        if not p['poisonType'] or not p['costGp']:
            print('poison %s is missing a type or a price' % p['name'], file=sys.stderr)
    for t in out['traps']:
        if not t['severity'] or not t['trigger']:
            print('trap %s is missing a severity or a trigger' % t['name'], file=sys.stderr)

    json.dump(out, open(OUT, 'w'), indent=1)
    print('%s: %s' % (OUT, {k: len(v) for k, v in out.items()}), file=sys.stderr)


if __name__ == '__main__':
    main()
