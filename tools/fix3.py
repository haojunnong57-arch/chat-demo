import pathlib
import sys

BROKEN_ZH = "settingsChatBackgroundEmpty: '点击这里选择一张照片'\n  settingsChatBackgroundDefault: '原版',\n  settingsChatBackgroundSea: '海景',,"
GOOD_ZH = "settingsChatBackgroundEmpty: '点击这里选择一张照片',\n  settingsChatBackgroundDefault: '原版',\n  settingsChatBackgroundSea: '海景',"
BROKEN_EN = "settingsChatBackgroundEmpty: 'Tap here to choose a photo'\n  settingsChatBackgroundDefault: 'Original',\n  settingsChatBackgroundSea: 'Sea cave',,"
GOOD_EN = "settingsChatBackgroundEmpty: 'Tap here to choose a photo',\n  settingsChatBackgroundDefault: 'Original',\n  settingsChatBackgroundSea: 'Sea cave',"


def fix(path, broken, good):
    p = pathlib.Path(path)
    s = p.read_text()
    if broken not in s:
        print('already-clean', path)
        return
    p.write_text(s.replace(broken, good, 1))
    print('fixed', path)


fix('src/i18n/zh.ts', BROKEN_ZH, GOOD_ZH)
fix('src/i18n/en.ts', BROKEN_EN, GOOD_EN)

# 确认语法能过
import subprocess
r = subprocess.run(['npx', '--yes', 'tsc', '-p', 'tsconfig.json', '--noEmit'], check=False)
print('tsc exit', r.returncode)
if r.returncode != 0:
    sys.exit(1)
print('FIX3_OK')
