import pathlib

DROP_KEYS = ('settingsChatBackgroundDefault', 'settingsChatBackgroundSea')

for f in ['src/i18n/zh.ts', 'src/i18n/en.ts']:
    p = pathlib.Path(f)
    lines = p.read_text().split('\n')
    out = []
    for line in lines:
        if any(k in line for k in DROP_KEYS):
            continue
        if 'settingsChatBackgroundEmpty' in line and not line.rstrip().endswith(','):
            line = line.rstrip() + ','
        out.append(line)
    p.write_text('\n'.join(out))
    print('cleaned', f)

import subprocess
r = subprocess.run(['npx', '--yes', 'tsc', '-p', 'tsconfig.json', '--noEmit'], check=False)
print('tsc exit', r.returncode)
raise SystemExit(r.returncode)
