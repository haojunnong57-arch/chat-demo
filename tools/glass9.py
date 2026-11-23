import pathlib
import sys


def edit(path, old, new, count=1):
    p = pathlib.Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        sys.exit(f'MISS in {path}: {old[:70]}')
    text = text.replace(old, new, count)
    p.write_text(text, encoding='utf-8')
    print(f'ok {path}')


# 1) 浅色玻璃主题：去掉彩色光斑，换成克制的中性底
edit(
    'src/app/chatThemes.css',
    """  --chat-page-bg:
    radial-gradient(1100px 760px at 8% -8%, rgba(0, 122, 255, 0.26), transparent 62%),
    radial-gradient(900px 700px at 96% 12%, rgba(255, 45, 85, 0.16), transparent 65%),
    radial-gradient(800px 620px at 50% 100%, rgba(52, 199, 89, 0.16), transparent 68%),
    linear-gradient(145deg, #eff5ff 0%, #dfe8f5 48%, #f5ecf7 100%);""",
    """  --chat-page-bg:
    radial-gradient(130% 92% at 50% -12%, #ffffff 0%, rgba(255, 255, 255, 0) 64%),
    linear-gradient(180deg, #f1f3f5 0%, #e6e9ed 100%);"""
)

# 2) 深色玻璃主题：同样换中性底
edit(
    'src/app/chatThemes.css',
    """  --chat-page-bg:
    radial-gradient(1100px 760px at 8% -8%, rgba(10, 132, 255, 0.32), transparent 62%),
    radial-gradient(900px 700px at 96% 12%, rgba(255, 55, 95, 0.22), transparent 65%),
    radial-gradient(800px 620px at 50% 100%, rgba(48, 209, 88, 0.14), transparent 68%),
    linear-gradient(145deg, #0b1220 0%, #131a2a 48%, #1c1422 100%);""",
    """  --chat-page-bg:
    radial-gradient(130% 92% at 50% -12%, #1b1e23 0%, rgba(27, 30, 35, 0) 64%),
    linear-gradient(180deg, #131519 0%, #0b0c0f 100%);"""
)

# 3) 深色输入框：从深色实心块改成浅色雾面（真正的毛玻璃）
edit(
    'src/app/chatThemes.css',
    '  --chat-input-bg: rgba(10, 16, 28, calc(var(--glass-fill, 0.32) * 0.95));',
    '  --chat-input-bg: rgba(255, 255, 255, calc(var(--glass-fill, 0.16) * 0.5 + 0.03));'
)

# 4) 通透度滑块真正生效：填充 0.34→0.05，模糊 32→6
edit(
    'src/components/session/SessionView.tsx',
    """          '--glass-fill': `${(0.44 - glassOpacity * 0.18).toFixed(3)}`,
          '--glass-blur': `${Math.round(18 + (1 - glassOpacity) * 20)}px`,""",
    """          '--glass-fill': `${(0.34 - glassOpacity * 0.29).toFixed(3)}`,
          '--glass-blur': `${Math.round(6 + (1 - glassOpacity) * 26)}px`,"""
)

edit(
    'src/components/session/Welcome.tsx',
    """          '--glass-fill': `${(0.44 - glassOpacity * 0.18).toFixed(3)}`,
          '--glass-blur': `${Math.round(18 + (1 - glassOpacity) * 20)}px`,""",
    """          '--glass-fill': `${(0.34 - glassOpacity * 0.29).toFixed(3)}`,
          '--glass-blur': `${Math.round(6 + (1 - glassOpacity) * 26)}px`,"""
)

# 5) 玻璃材质：焦散改成中性柔光，去掉彩色 AI 味
edit(
    'src/components/base/LiquidGlassSurface.module.css',
    """  background:
    radial-gradient(42% 36% at 26% 34%, rgba(120, 190, 255, 0.25), transparent 70%),
    radial-gradient(38% 30% at 76% 64%, rgba(255, 130, 180, 0.16), transparent 72%),
    radial-gradient(46% 32% at 56% 94%, rgba(110, 235, 205, 0.16), transparent 74%);
  filter: blur(18px) saturate(130%);
  mix-blend-mode: soft-light;""",
    """  background:
    radial-gradient(44% 38% at 26% 32%, rgba(255, 255, 255, 0.42), transparent 72%),
    radial-gradient(40% 32% at 74% 66%, rgba(255, 255, 255, 0.16), transparent 74%);
  filter: blur(20px) saturate(100%);
  mix-blend-mode: soft-light;"""
)

# 6) 反光光泽加强：顶部镜面 + 斜向高光条
edit(
    'src/components/base/LiquidGlassSurface.module.css',
    """  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.34) 0%,
    rgba(255, 255, 255, 0.10) 18%,
    rgba(255, 255, 255, 0) 62%
  );""",
    """  background:
    linear-gradient(112deg, rgba(255, 255, 255, 0) 26%, rgba(255, 255, 255, 0.30) 44%, rgba(255, 255, 255, 0) 60%),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.52) 0%,
      rgba(255, 255, 255, 0.14) 20%,
      rgba(255, 255, 255, 0) 64%
    );"""
)

print('done')
