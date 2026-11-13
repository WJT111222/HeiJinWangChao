from pathlib import Path
import yaml
w = yaml.load(Path('.github/workflows/publish-announcement.yml').read_text(), Loader=yaml.BaseLoader)
assert w['on']['push']['branches'] == ['main']
assert w['permissions']['contents'] == 'read'
assert w['concurrency']['cancel-in-progress'] == 'false'
j = w['jobs']['publish']
assert j['if'] == "github.ref == 'refs/heads/main'"
assert j['timeout-minutes'] == '10'
publish = next(s for s in j['steps'] if s.get('id') == 'publish')
verify = next(s for s in j['steps'] if '--verify' in s.get('run', ''))
assert publish['run'] == 'node scripts/publish-announcement.mjs'
assert verify['if'] == "steps.publish.outputs.version != ''"
assert verify['env']['ANNOUNCEMENT_VERSION'] == '${{ steps.publish.outputs.version }}'
print('YAML parsed; main-only job, read-only repository permissions, serial group and version output -> verify preserved.')
