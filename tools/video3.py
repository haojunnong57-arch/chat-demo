import pathlib
import sys

path = 'src/app/App.tsx'
p = pathlib.Path(path)
text = p.read_text(encoding='utf-8')
old = """        mode === 'open'
          ? progress >= SNAP_RATIO || (dx > 0 && velocity > FLING_VELOCITY)"""
new = """        mode === 'open'
          // 左缘轻扫也要自动弹出：位移过 22% 或有一点右滑速度就吸附展开
          ? progress >= 0.22 || (dx > 10 && velocity > FLING_VELOCITY * 0.5)"""
if old not in text:
    sys.exit('MISS App.tsx')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('ok App.tsx')
