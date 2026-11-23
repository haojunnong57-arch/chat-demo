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


def append(path, extra):
    p = pathlib.Path(path)
    p.write_text(p.read_text(encoding='utf-8').rstrip() + '\n' + extra, encoding='utf-8')
    print(f'append {path}')


# 1) 回弹：写入合并到每帧一次，避免 touchmove 高频写 transform 掉帧
edit(
    'src/components/messages/useRubberBand.ts',
    """    const write = (value: number) => {
      offset = value
      content.style.transform = value === 0 ? '' : `translate3d(0, ${value.toFixed(2)}px, 0)`
      content.style.setProperty('--rubber-progress', Math.min(1, Math.abs(value) / LIMIT).toFixed(3))
    }""",
    """    const write = (value: number) => {
      offset = value
      content.style.transform = value === 0 ? '' : `translate3d(0, ${value.toFixed(2)}px, 0)`
      content.style.setProperty('--rubber-progress', Math.min(1, Math.abs(value) / LIMIT).toFixed(3))
    }

    // 每帧最多写一次：touchmove 频率可达 120Hz，逐条写会抖成重影
    let pendingValue = 0
    let writeFrame = 0
    const scheduleWrite = (value: number) => {
      pendingValue = value
      if (writeFrame) {
        return
      }
      writeFrame = requestAnimationFrame(() => {
        writeFrame = 0
        write(pendingValue)
      })
    }"""
)

# 2) 拖拽中把内容提到独立合成层，消除重影
edit(
    'src/components/messages/useRubberBand.ts',
    """        dragging = true
        content.dataset.rubber = 'true'
      }""",
    """        dragging = true
        content.dataset.rubber = 'true'
        content.style.backfaceVisibility = 'hidden'
        content.style.transform = 'translate3d(0, 0, 0)'
      }"""
)

edit(
    'src/components/messages/useRubberBand.ts',
    '      write(resisted)',
    '      scheduleWrite(resisted)'
)

# 3) 回弹结束清掉合成层提示
edit(
    'src/components/messages/useRubberBand.ts',
    """          write(0)
          content.removeAttribute('data-rubber')
          content.style.willChange = ''""",
    """          write(0)
          content.removeAttribute('data-rubber')
          content.style.willChange = ''
          content.style.removeProperty('backface-visibility')"""
)

edit(
    'src/components/messages/useRubberBand.ts',
    """      content.style.removeProperty('--rubber-progress')
      content.style.willChange = ''""",
    """      content.style.removeProperty('--rubber-progress')
      content.style.willChange = ''
      content.style.removeProperty('backface-visibility')"""
)

# 4) 列表：拖拽时彻底关掉子层 backdrop 模糊（iOS 上会重算整层，产生重影掉帧）
edit(
    'src/components/messages/MessageList.module.css',
    """.column[data-rubber='true'] {
  will-change: transform;
}""",
    """.column[data-rubber='true'] {
  will-change: transform;
}

/* 回弹时整列在动，气泡上的 backdrop 模糊会逐帧重算，导致重影与卡顿 */
.column[data-rubber='true'] * {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}"""
)

# 5) 移动端气泡不再逐条磨砂（性能优先，视觉仍是半透明玻璃）
edit(
    'src/app/chatThemes.css',
    """/* ---------- 深色模式：同色系、低对比、保留皮肤识别度 ---------- */""",
    """/* 移动端：气泡不做逐个 backdrop 模糊，滚动/回弹才跟手 */
@media not all and (min-width: 768px) {
  .chat-theme-glass {
    --chat-bubble-backdrop: none;
  }
}

/* ---------- 深色模式：同色系、低对比、保留皮肤识别度 ---------- */"""
)

# 6) 输入框少一点磨砂，多一点透光折射（真液态玻璃而不是毛玻璃板）
edit(
    'src/app/chatThemes.css',
    '  --chat-input-backdrop: saturate(190%) blur(var(--glass-blur, 30px));',
    '  --chat-input-backdrop: saturate(185%) blur(calc(var(--glass-blur, 30px) * 0.55));',
    2
)

# 7) 折射与色散加强：边缘出现玻璃弯折与彩边
edit(
    'src/components/base/LiquidGlassSurface.tsx',
    "    (isGlassTheme ? Math.round((48 + glassOpacity * 86) * (strength === 'strong' ? 0.92 : 1)) : 42)",
    "    (isGlassTheme ? Math.round((62 + glassOpacity * 96) * (strength === 'strong' ? 0.92 : 1)) : 42)"
)

edit(
    'src/components/base/LiquidGlassSurface.tsx',
    '        saturation={isGlassTheme ? 165 : 140}',
    '        saturation={isGlassTheme ? 176 : 140}'
)

edit(
    'src/components/base/LiquidGlassSurface.tsx',
    '        aberrationIntensity={isGlassTheme ? 2.4 : 1.4}',
    '        aberrationIntensity={isGlassTheme ? 2.9 : 1.4}'
)

# 8) 深色下的高光提亮，别让玻璃在暗色里失去光泽
edit(
    'src/components/base/LiquidGlassSurface.module.css',
    """[data-ds-dark-theme] .specular,
body.dark .specular {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.07) 0%,
    rgba(255, 255, 255, 0.02) 20%,
    rgba(255, 255, 255, 0) 62%
  );
}""",
    """[data-ds-dark-theme] .specular,
body.dark .specular {
  background:
    linear-gradient(112deg, rgba(255, 255, 255, 0) 26%, rgba(255, 255, 255, 0.16) 44%, rgba(255, 255, 255, 0) 60%),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.30) 0%,
      rgba(255, 255, 255, 0.08) 22%,
      rgba(255, 255, 255, 0) 64%
    );
}"""
)

edit(
    'src/components/base/LiquidGlassSurface.module.css',
    """    inset 0 0 0 0.5px rgba(255, 255, 255, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.10),""",
    """    inset 0 0 0 0.5px rgba(255, 255, 255, 0.34),
    inset 2px 2px 0 rgba(255, 255, 255, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),"""
)

# 9) 高光缓慢呼吸：玻璃有流动的光泽，不是静态磨砂
append(
    'src/components/base/LiquidGlassSurface.module.css',
    """
/* 液态玻璃高光呼吸：轻微位移 + 亮度变化，读起来是流动的光而不是死板的雾面 */
.backdrop .specular {
  will-change: opacity, transform;
  animation: glassSheen 6.5s ease-in-out infinite alternate;
}

@keyframes glassSheen {
  from {
    opacity: 0.82;
    transform: translate3d(-1.5%, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(1.5%, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop .specular {
    animation: none;
  }
}
"""
)

print('done')
