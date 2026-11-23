import pathlib
import re

PATTERN = re.compile(
    r"(settingsChatBackgroundEmpty: '[^']*')(,?)\n\s*settingsChatBackgroundDefault: '[^']*',?\n\s*settingsChatBackgroundSea: '[^']*',*,*"
)

for f in ['src/i18n/zh.ts', 'src/i18n/en.ts']:
    p = pathlib.Path(f)
    s = p.read_text()
    s2, n = PATTERN.subn(r"\1,", s)
    p.write_text(s2)
    print(f, 'rewrites', n)

# 背景预设按钮改用字面文案，不再依赖新增 i18n key
bg = pathlib.Path('src/components/settings/BackgroundSetting.tsx')
bs = bg.read_text()
bs = bs.replace("{t('settingsChatBackgroundDefault')}", '原版')
bs = bs.replace("{t('settingsChatBackgroundSea')}", '海景')
bg.write_text(bs)
print('bg labels ok')

import subprocess
reg = subprocess.run(
    "grep -n \"settingsChatBackgroundEmpty\|settingsChatBackgroundDefault\|settingsChatBackgroundSea\" src/i18n/zh.ts src/i18n/en.ts",
    shell=True,
    capture_output=True,
    text=True,
)
print(reg.stdout)

r = subprocess.run(['npx', '--yes', 'tsc', '-p', 'tsconfig.json', '--noEmit'], check=False)
print('tsc exit', r.returncode)
raise SystemExit(r.returncode)
