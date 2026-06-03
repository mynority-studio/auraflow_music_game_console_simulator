# -*- coding: utf-8 -*-
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(r"Z:\auraflow_music_game_console_simulator")
OUT = ROOT / "docs" / "music_engine_ascii_flow.jpg"


def pick_font() -> str:
    candidates = [
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\consola.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return path
    raise RuntimeError("No usable font found")


TEXT = r"""
+======================================================================================================================+
|                                  MUSIC GENERATION ENGINE V3 - ASCII FLOW MAP                                         |
|                                  伴奏优先 / hook 锚点预处理 / 只读 Auditor / 有预算重跑环                             |
+======================================================================================================================+

                         +----------------------------------------------------------------------------+
                         | GLOBAL MUSIC KNOWLEDGE BASE  全局音乐知识库                                  |
                         |----------------------------------------------------------------------------|
                         | 候选 + 权重 + 模板 + 约束 + 风格配方 + 张力模型                              |
                         | Engine 查询 KB,再按 seed / section / energy 绑定到当前曲子                    |
                         |----------------------------------------------------------------------------|
                         | Pitch / Duration / TimeFeel / Scale / Chord / Progression / Style           |
                         | Groove / Texture / Voicing / Grammar / GuideTone / ClimaxRecipe / Tension  |
                         +----------------------------------------------------------------------------+
                                      ^                 ^                 ^                 ^
                                      | query           | query           | query           | query

+----------------------------------------------------------------------------------------------------------------------+
|                                               GENERATION CONTROLLER                                                   |
|----------------------------------------------------------------------------------------------------------------------|
| 调度整条生成链路,读取 AuditReport,决定回到哪里重跑,每次重跑必须改变 RetryContext,并受 retry budget 限制。              |
+----------------------------------------------------------------------------------------------------------------------+
                |
                v
  +-------------+--------------+
  | Generation Request          |
  | seed / style / mood         |
  | duration / game context     |
  +-------------+--------------+
                |
                v
  +-------------+--------------+      lookup style/key/mode/instrument priors
  | L1 BAND ENGINE              | <-----------------------------------------------+
  |----------------------------|                                                 |
  | 定义这首歌是什么             |                                                 |
  | style / tonal-modal / key   |                                                 |
  | mode / instrument pool      |                                                 |
  | primaryScale policy         |                                                 |
  | OUT: BandSpec               |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+      lookup form/time/energy/phrase recipes     |
  | L2 ARRANGER                 | <-----------------------------------------------+
  |----------------------------|                                                 |
  | 定义这首歌怎么展开           |                                                 |
  | FormPlanner                 | sections / repeats / hook placement             |
  | TimePlanner                 | tempo / meter / feel / phrase breathing         |
  | DynamicsPlanner             | energy / density / climax / harmonic rhythm     |
  | PhrasePlanner               | phrase role / cadence / restatementStrength     |
  | OUT: ArrangementPlan        |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+      consume energy + harmonic rhythm targets    |
  | L3 HARMONY / MG ENGINE      | <-----------------------------------------------+
  |----------------------------|                                                 |
  | 把段落目标落实成和声          |                                                 |
  | roman progression           |                                                 |
  | chord timeline / function   |                                                 |
  | chordScaleMap / tensionMap  |                                                 |
  | stable / color / avoid tones|                                                 |
  | commonSafeToneSet query     |                                                 |
  | OUT: HarmonicPlan           |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+      lookup range/texture/voicing/groove rules   |
  | L4 INSTRUMENTAL PLANNER     | <-----------------------------------------------+
  |----------------------------|                                                 |
  | 决定谁来演,在哪演,怎么演      |                                                 |
  | activity / register plan    |                                                 |
  | texture / voicing plan      |                                                 |
  | silence / articulation      |                                                 |
  | melodyReservationPlan       | hook 音区/节奏/重音锚点预留                    |
  | OUT: InstrumentationPlan    |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
+---------------+------------------------------------------------------------------------------------------------------+
| L5 RENDER LAYER - RenderCoordinator                                                                                  |
|----------------------------------------------------------------------------------------------------------------------|
| 正式伴奏先生成,但在伴奏前做轻量 Motif / Anchor Prepass:只确定 hook 身份和锚点,不生成完整旋律。                         |
+---------------+------------------------------------------------------------------------------------------------------+
                |
                v
  +-------------+--------------+      lookup Grammar / GuideTone / Tension
  | MOTIF / ANCHOR PREPASS     | <-----------------------------------------------+
  |----------------------------|                                                 |
  | 选择 skeleton source         | hook -> Grammar cell                            |
  | 生成或召回 Motif             | connector/cadence -> GuideTone                  |
  | 计算 commonSafeToneSet       | 跨和弦安全音交集                                |
  | 写入 selectedAnchorPitches   | 给伴奏让位使用                                  |
  | OUT: MelodyAnchorPlan       |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+                                                 |
  | ACCOMPANIMENT RENDERER      |                                                 |
  |----------------------------|                                                 |
  | drums / bass / comp / pad    |                                                 |
  | voicing / arpeggio           |                                                 |
  | obey melody anchors          |                                                 |
  | voicing support ladder       | open / omit / register / density                |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+                                                 |
  | OCCUPATION MAP              |                                                 |
  |----------------------------|                                                 |
  | occupied registers           |                                                 |
  | rhythm density by beat       |                                                 |
  | accent / chord hit map       |                                                 |
  | free windows                 |                                                 |
  | anchor conflict risk         |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+      lookup Grammar variation + GuideTone tail   |
  | MELODY RENDERER             | <-----------------------------------------------+
  |----------------------------|                                                 |
  | Skeleton source              |                                                 |
  | Motif recall/create          | motifId 主键                                    |
  | restatementStrength          | lock: rhythm > contour > pitch                  |
  | Grammar variation            | transform / divide / development                |
  | Tail by phrase function      | antecedent / consequent / climax / cadence      |
  | Fit occupation map           |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+                                                 |
  | INTERACTION RESOLVER         |                                                 |
  |----------------------------|                                                 |
  | 生成期 mutator,可以改音符     |                                                 |
  | register collision           |                                                 |
  | accent clash                 |                                                 |
  | forbidden interval exposure  |                                                 |
  | local voicing adjustment     |                                                 |
  +-------------+--------------+                                                 |
                |                                                                |
                v                                                                |
  +-------------+--------------+      query same tension model                   |
  | READ-ONLY HARMONY AUDITOR   | <-----------------------------------------------+
  |----------------------------|
  | 末端只读终检,永不 mutate     |
  | chord fit / tension class    |
  | avoid-note exposure          |
  | forbidden intervals          |
  | tendency-tone errors         |
  | OUT: AuditReport             |
  +-------------+--------------+
                |
       pass     |       warning / error / fatal
    +-----------+----------------------------+
    |                                        |
    v                                        v
  +-------------+--------------+       +-----+-----------------------------------------------+
  | FINAL MUSICAL IR           |       | GENERATION CONTROLLER                               |
  | tracks / notes / timing    |       |-----------------------------------------------------|
  | velocity / articulation    |       | retry with changed RetryContext:                     |
  +-------------+--------------+       | - advance RNG / choose next candidate                |
                |                      | - lower restatementStrength                           |
                v                      | - switch hook / regenerate tail                       |
  +-------------+--------------+       | - safer voicing / local density reduction             |
  | MIDI / AUDIO / GAME        |       | - safe section harmony fallback                       |
  +----------------------------+       +-----+--------------------+--------------------+------+
                                              |                    |                    |
                                              v                    v                    v
                                     back to Resolver      back to Melody       back to Voicing/Harmony

+----------------------------------------------------------------------------------------------------------------------+
| KEY DESIGN RULES V3                                                                                                  |
|----------------------------------------------------------------------------------------------------------------------|
| 1. Motif 身份分层: rhythmCell > contourGesture > pitch。                                                              |
| 2. restatementStrength 是锁深度滑块,由 Arranger 逐 repeatGroup / phraseSlot 下发。                                    |
| 3. hook head / 重音 / 骨干音必须来自 commonSafeToneSet。                                                               |
| 4. 撞音先用 voicing 支撑: open voicing / omit rule / register separation / density reduction。                         |
| 5. 再不行换 hook,再不行降锁深度,最后进入 GenerationController 的预算化重跑。                                           |
| 6. Auditor 只读、严格、无人为意图豁免;选音和审计共用同一张 tension model。                                             |
+======================================================================================================================+
""".strip("\n").splitlines()


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font_path = pick_font()
    font_size = 30
    font = ImageFont.truetype(font_path, font_size)
    small_font = ImageFont.truetype(font_path, 22)

    probe_img = Image.new("RGB", (10, 10))
    probe = ImageDraw.Draw(probe_img)
    line_height = int(font_size * 1.45)
    widths = [probe.textbbox((0, 0), line, font=font)[2] for line in TEXT]

    margin_x = 80
    margin_y = 70
    footer_h = 42
    width = max(widths) + margin_x * 2
    height = len(TEXT) * line_height + margin_y * 2 + footer_h

    img = Image.new("RGB", (width, height), (12, 17, 27))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, 120], fill=(18, 27, 43))

    y = margin_y
    for line in TEXT:
        color = (224, 231, 241)
        if "====" in line:
            color = (99, 179, 237)
        elif "GLOBAL MUSIC KNOWLEDGE BASE" in line or "全局音乐知识库" in line:
            color = (246, 213, 92)
        elif "GENERATION CONTROLLER" in line:
            color = (255, 220, 130)
        elif any(label in line for label in ["L1 BAND ENGINE", "L2 ARRANGER", "L3 HARMONY", "L4 INSTRUMENTAL", "L5 RENDER"]):
            color = (132, 221, 176)
        elif any(label in line for label in ["MOTIF / ANCHOR PREPASS", "ACCOMPANIMENT RENDERER", "OCCUPATION MAP", "MELODY RENDERER"]):
            color = (255, 184, 108)
        elif any(label in line for label in ["INTERACTION RESOLVER", "READ-ONLY HARMONY AUDITOR", "FINAL MUSICAL IR"]):
            color = (197, 170, 255)
        elif "KEY DESIGN RULES" in line:
            color = (255, 220, 130)
        elif "query" in line or "<---" in line or "-->" in line or "back to" in line:
            color = (143, 201, 255)
        draw.text((margin_x, y), line, font=font, fill=color)
        y += line_height

    footer = "ASCII flow map V3 generated for architecture discussion - docs/music_engine_ascii_flow.jpg"
    draw.text((margin_x, height - margin_y + 15), footer, font=small_font, fill=(132, 145, 166))
    img.save(OUT, "JPEG", quality=95, optimize=True)
    print(OUT)
    print(f"{width}x{height}")


if __name__ == "__main__":
    main()
