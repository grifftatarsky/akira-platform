"""Parse the SRD 5.2.1 species descriptions into species and their traits.

Nine species on pp. 83-86, each printed the same way: a name, three labelled
lines, and a run of traits whose names are set in bold at the head of their
paragraph. That bold is the only thing marking a trait name as a name rather
than the first two words of a sentence, which is why this reads the font.
"""
import json
import re
import sys

from srdtext import join_wrapped, reflow, xml_lines

OUT = 'species.json'
SPECIES_PAGES = (83, 87)

SIZES = {'Tiny': 'TINY', 'Small': 'SMALL', 'Medium': 'MEDIUM', 'Large': 'LARGE',
         'Huge': 'HUGE', 'Gargantuan': 'GARGANTUAN'}
MOVEMENT = {'Speed': 'WALK', 'Fly Speed': 'FLY', 'Swim Speed': 'SWIM',
            'Climb Speed': 'CLIMB', 'Burrow Speed': 'BURROW'}
LABEL = re.compile(r'^(Creature Type|Size|Speed):\s*(.+)$')


def parse_size(text):
    """'Small or Medium (about 3-4 feet tall)' -> ('SMALL', 'MEDIUM')."""
    found = [SIZES[w] for w in re.findall(r'\b\w+\b', text) if w in SIZES]
    return (found[0] if found else None, found[1] if len(found) > 1 else None)


def main():
    entries, cur, reading, prev = [], None, False, None
    for line in xml_lines(*SPECIES_PAGES):
        if line.kind == 'section':
            reading = line.text == 'Species Descriptions'
            continue
        if line.kind == 'chapter':
            reading = False
            continue
        if not reading:
            continue
        if line.kind == 'head':
            cur = {'name': line.text, 'labels': {}, 'traits': [], 'lead': []}
            entries.append(cur)
            prev = None
            continue
        if cur is None:
            continue
        m = LABEL.match(line.text)
        if m:
            cur['labels'][m.group(1)] = m.group(2)
            continue
        if line.kind == 'table':
            # A table belongs to the trait it illustrates — Draconic Ancestors
            # to Draconic Ancestry — and its header row is bold, so it must not
            # be mistaken for the start of a new one.
            target = (prev.get('_open') or prev) if prev else None
            (target['lines'] if target else cur['lead']).append((line.kind, False, line.text))
            continue
        if line.bold and line.bold_italic:
            # A new trait. The bold run-in is its name, including the period the
            # book sets in bold with it.
            prev = {'name': line.bold.rstrip('.').strip(), 'options': [],
                    'lines': [(line.kind, False, line.text[len(line.bold):].strip())]}
            cur['traits'].append(prev)
        elif line.bold and prev is not None:
            # Bold without italic is an option *inside* the current trait — the
            # Goliath's six giant ancestries, the Gnome's two lineages. You pick
            # one, so they are not siblings of the trait that offers them.
            option = {'name': line.bold.rstrip('.').strip(),
                      'lines': [(line.kind, False, line.text[len(line.bold):].strip())]}
            prev['options'].append(option)
            # Continuations now belong to the option, not to the trait around it.
            prev['_open'] = option
        elif prev is not None:
            target = prev.get('_open') or prev
            target['lines'].append((line.kind, line.indented, line.text))
        else:
            cur['lead'].append((line.kind, line.indented, line.text))

    out = []
    for e in entries:
        size, alternate = parse_size(e['labels'].get('Size', ''))
        speed = re.search(r'(\d+)', e['labels'].get('Speed', '') or '')
        out.append({
            'name': e['name'],
            'creatureType': (e['labels'].get('Creature Type') or '').upper() or None,
            'size': size,
            'alternateSize': alternate,
            'speeds': {'WALK': int(speed.group(1))} if speed else {},
            # The book's "As a Dwarf, you have these special traits." is the
            # lead-in, not a description, so anything before the first trait is.
            'description': reflow(e['lead']),
            'traits': [{'name': t['name'], 'description': reflow(t['lines']),
                        'options': [{'name': o['name'], 'description': reflow(o['lines'])}
                                    for o in t['options']]}
                       for t in e['traits']],
        })

    for s in out:
        if not s['size'] or not s['creatureType'] or not s['traits']:
            print('%s is missing size, type or traits' % s['name'], file=sys.stderr)
    json.dump(out, open(OUT, 'w'), indent=1)
    print('%s: %d species, %d traits' % (OUT, len(out), sum(len(s['traits']) for s in out)),
          file=sys.stderr)


if __name__ == '__main__':
    main()
