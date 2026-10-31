import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs('store_assets', exist_ok=True)
os.makedirs('icons', exist_ok=True)

def get_font(size, bold=False):
    # Try common Windows fonts
    font_names = [
        "C:\\Windows\\Fonts\\segoeuib.ttf" if bold else "C:\\Windows\\Fonts\\segoeui.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf" if bold else "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\calibrib.ttf" if bold else "C:\\Windows\\Fonts\\calibri.ttf"
    ]
    for path in font_names:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

def draw_gradient_rect(draw, bbox, start_color, end_color, radius=0):
    x0, y0, x1, y1 = bbox
    w = x1 - x0
    h = y1 - y0
    base = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for i in range(h):
        ratio = i / float(h)
        r = int(start_color[0] * (1 - ratio) + end_color[0] * ratio)
        g = int(start_color[1] * (1 - ratio) + end_color[1] * ratio)
        b = int(start_color[2] * (1 - ratio) + end_color[2] * ratio)
        for j in range(w):
            base.putpixel((j, i), (r, g, b, 255))
    
    if radius > 0:
        mask = Image.new('L', (w, h), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, w, h], radius=radius, fill=255)
        return base, mask
    return base, None

# 1. Generate icon-300.png (300x300)
def generate_icon_300():
    size = 300
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / 128.0
    radius = int(28 * s)
    margin = int(6 * s)

    # Gradient background
    steps = 60
    for i in range(steps):
        ratio = i / float(steps)
        r = int(79 * (1 - ratio) + 147 * ratio)
        g = int(70 * (1 - ratio) + 51 * ratio)
        b = int(229 * (1 - ratio) + 234 * ratio)
        inset_top = margin + int((size - 2 * margin) * (i / float(steps)))
        inset_bottom = margin + int((size - 2 * margin) * ((i + 1) / float(steps)))
        
        mask_layer = Image.new('L', (size, size), 0)
        mask_draw = ImageDraw.Draw(mask_layer)
        mask_draw.rounded_rectangle([margin, margin, size - margin, size - margin], radius=radius, fill=255)
        
        slice_img = Image.new('RGBA', (size, size), (r, g, b, 255))
        stripe_mask = Image.new('L', (size, size), 0)
        stripe_draw = ImageDraw.Draw(stripe_mask)
        stripe_draw.rectangle([0, inset_top, size, inset_bottom], fill=255)
        
        combined_mask = Image.new('L', (size, size), 0)
        for y in range(inset_top, min(inset_bottom, size)):
            for x in range(size):
                if mask_layer.getpixel((x, y)) > 0:
                    combined_mask.putpixel((x, y), 255)
        img.paste(slice_img, (0, 0), combined_mask)

    border_draw = ImageDraw.Draw(img)
    border_draw.rounded_rectangle([margin, margin, size - margin, size - margin], radius=radius, outline=(255, 255, 255, 80), width=max(1, int(3 * s)))

    cx, cy = size / 2.0, size / 2.0
    p_size = 18 * s
    play_poly = [
        (cx - p_size * 0.7, cy - p_size),
        (cx + p_size * 1.1, cy),
        (cx - p_size * 0.7, cy + p_size)
    ]
    border_draw.polygon(play_poly, fill=(255, 255, 255, 250))

    b_margin = 18 * s
    b_len = 16 * s
    b_w = max(1, int(4 * s))
    border_draw.line([(b_margin, b_margin + b_len), (b_margin, b_margin), (b_margin + b_len, b_margin)], fill=(255, 255, 255, 240), width=b_w)
    border_draw.line([(size - b_margin - b_len, b_margin), (size - b_margin, b_margin), (size - b_margin, b_margin + b_len)], fill=(255, 255, 255, 240), width=b_w)
    border_draw.line([(b_margin, size - b_margin - b_len), (b_margin, size - b_margin), (b_margin + b_len, size - b_margin)], fill=(255, 255, 255, 240), width=b_w)
    border_draw.line([(size - b_margin - b_len, size - b_margin), (size - b_margin, size - b_margin), (size - b_margin, size - b_margin - b_len)], fill=(255, 255, 255, 240), width=b_w)

    img.save('icons/icon-300.png', 'PNG')
    img.save('store_assets/icon-300.png', 'PNG')
    print("Generated icons/icon-300.png (300x300)")

# 2. Screenshots (1280x800)
def generate_screenshot_1():
    w, h = 1280, 800
    img = Image.new('RGB', (w, h), (15, 23, 42)) # Slate 900
    draw = ImageDraw.Draw(img)

    # Gradient top bar
    for y in range(120):
        alpha = y / 120.0
        r = int(30 * (1 - alpha) + 15 * alpha)
        g = int(41 * (1 - alpha) + 23 * alpha)
        b = int(59 * (1 - alpha) + 42 * alpha)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    font_title = get_font(40, bold=True)
    font_sub = get_font(20, bold=False)
    font_badge = get_font(16, bold=True)
    font_ui = get_font(18, bold=True)
    font_desc = get_font(15, bold=False)

    draw.text((60, 36), "MaxVideo Pro — Clean Window Mode", font=font_title, fill=(248, 250, 252))
    draw.text((60, 85), "Distraction-free video pop-out window with zero tabs, zero URL bars, and zero bookmarks", font=font_sub, fill=(148, 163, 184))

    # Badge Alt + W
    draw.rounded_rectangle([1050, 45, 1220, 85], radius=10, fill=(79, 70, 229))
    draw.text((1075, 52), "SHORTCUT: Alt+W", font=font_badge, fill=(255, 255, 255))

    # Left: Window mockup
    win_x0, win_y0, win_x1, win_y1 = 60, 140, 840, 740
    draw.rounded_rectangle([win_x0, win_y0, win_x1, win_y1], radius=16, fill=(2, 6, 23), outline=(51, 65, 85), width=2)
    # Window titlebar (compact clean)
    draw.rounded_rectangle([win_x0, win_y0, win_x1, win_y0 + 36], radius=16, fill=(30, 41, 59))
    draw.rectangle([win_x0, win_y0 + 20, win_x1, win_y0 + 36], fill=(30, 41, 59))
    # Window controls (red, yellow, green dots)
    draw.ellipse([win_x0 + 16, win_y0 + 12, win_x0 + 28, win_y0 + 24], fill=(239, 68, 68))
    draw.ellipse([win_x0 + 36, win_y0 + 12, win_x0 + 48, win_y0 + 24], fill=(234, 179, 8))
    draw.ellipse([win_x0 + 56, win_y0 + 12, win_x0 + 68, win_y0 + 24], fill=(34, 197, 94))
    draw.text((win_x0 + 85, win_y0 + 8), "MaxVideo Pro Pop-Out [Clean Window]", font=font_desc, fill=(203, 213, 225))

    # Inner Video mockup (Dark scenery gradient)
    vid_x0, vid_y0, vid_x1, vid_y1 = win_x0 + 8, win_y0 + 40, win_x1 - 8, win_y1 - 8
    for vy in range(vid_y0, vid_y1):
        ratio = (vy - vid_y0) / float(vid_y1 - vid_y0)
        vr = int(17 * (1 - ratio) + 30 * ratio)
        vg = int(24 * (1 - ratio) + 41 * ratio)
        vb = int(39 * (1 - ratio) + 59 * ratio)
        draw.line([(vid_x0, vy), (vid_x1, vy)], fill=(vr, vg, vb))

    # Center Play graphic
    cx = (vid_x0 + vid_x1) // 2
    cy = (vid_y0 + vid_y1) // 2
    draw.ellipse([cx - 45, cy - 45, cx + 45, cy + 45], fill=(79, 70, 229, 220), outline=(255, 255, 255, 180), width=3)
    draw.polygon([(cx - 15, cy - 22), (cx + 25, cy), (cx - 15, cy + 22)], fill=(255, 255, 255))

    # Floating HUD Mockup in Video (top left)
    hud_x0, hud_y0, hud_x1, hud_y1 = vid_x0 + 20, vid_y0 + 20, vid_x0 + 260, vid_y0 + 64
    draw.rounded_rectangle([hud_x0, hud_y0, hud_x1, hud_y1], radius=12, fill=(15, 23, 42), outline=(99, 102, 241), width=2)
    # HUD buttons mock
    icons_text = ["⛶", "🗖", "⛶", "⧉", "📥", "⚙"]
    for idx, ic in enumerate(icons_text):
        bx = hud_x0 + 10 + idx * 40
        draw.rounded_rectangle([bx, hud_y0 + 6, bx + 32, hud_y0 + 38], radius=6, fill=(30, 41, 59))
        draw.text((bx + 8, hud_y0 + 10), ic, font=font_ui, fill=(241, 245, 249))

    # Right side: Feature cards
    features = [
        ("No Address Bar & No Tabs", "Removes browser chrome clutter so you can focus 100% on the video content."),
        ("Snap Side-by-Side", "Freely resize and snap alongside VS Code, Notion, or Office with Win + Arrows."),
        ("Multi-Monitor Ready", "Keeps full edge-to-edge video on your second screen without fullscreen trapping."),
        ("Preserves Native Controls", "Maintains high resolution, subtitles, timeline seeking, and audio channels.")
    ]
    card_y = 140
    for f_title, f_desc in features:
        draw.rounded_rectangle([870, card_y, 1220, card_y + 130], radius=12, fill=(30, 41, 59), outline=(51, 65, 85), width=1)
        draw.ellipse([890, card_y + 20, 915, card_y + 45], fill=(99, 102, 241))
        draw.text((900, card_y + 22), "✓", font=font_badge, fill=(255, 255, 255))
        draw.text((930, card_y + 20), f_title, font=font_ui, fill=(255, 255, 255))
        
        # Word wrap desc
        words = f_desc.split()
        line1 = " ".join(words[:6])
        line2 = " ".join(words[6:])
        draw.text((890, card_y + 55), line1, font=font_desc, fill=(148, 163, 184))
        draw.text((890, card_y + 78), line2, font=font_desc, fill=(148, 163, 184))
        card_y += 150

    img.save('store_assets/screenshot-1-clean-window.png', 'PNG')
    print("Generated store_assets/screenshot-1-clean-window.png (1280x800)")

def generate_screenshot_2():
    w, h = 1280, 800
    img = Image.new('RGB', (w, h), (15, 23, 42))
    draw = ImageDraw.Draw(img)

    for y in range(120):
        alpha = y / 120.0
        r = int(30 * (1 - alpha) + 15 * alpha)
        g = int(41 * (1 - alpha) + 23 * alpha)
        b = int(59 * (1 - alpha) + 42 * alpha)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    font_title = get_font(40, bold=True)
    font_sub = get_font(20, bold=False)
    font_badge = get_font(16, bold=True)
    font_ui = get_font(17, bold=True)
    font_desc = get_font(15, bold=False)

    draw.text((60, 36), "MaxVideo Pro — Smart HUD & Tools Menu", font=font_title, fill=(248, 250, 252))
    draw.text((60, 85), "Floating action bar with instant aspect ratio, speed, audio boost, and flip/rotate controls", font=font_sub, fill=(148, 163, 184))

    draw.rounded_rectangle([1050, 45, 1220, 85], radius=10, fill=(16, 185, 129))
    draw.text((1075, 52), "ZERO OVERLAP", font=font_badge, fill=(255, 255, 255))

    # Center: Mockup of video player with Floating HUD & Expanded Dropdown Menu
    vx0, vy0, vx1, vy1 = 120, 150, 1160, 730
    draw.rounded_rectangle([vx0, vy0, vx1, vy1], radius=16, fill=(2, 6, 23), outline=(71, 85, 105), width=2)
    
    # Video preview inner background
    for vy in range(vy0, vy1):
        ratio = (vy - vy0) / float(vy1 - vy0)
        vr = int(15 * (1 - ratio) + 25 * ratio)
        vg = int(23 * (1 - ratio) + 35 * ratio)
        vb = int(42 * (1 - ratio) + 50 * ratio)
        draw.line([(vx0, vy), (vx1, vy)], fill=(vr, vg, vb))

    # Floating HUD
    hud_x0, hud_y0, hud_x1, hud_y1 = vx0 + 40, vy0 + 40, vx0 + 320, vy0 + 90
    draw.rounded_rectangle([hud_x0, hud_y0, hud_x1, hud_y1], radius=12, fill=(15, 23, 42), outline=(129, 140, 248), width=2)
    icons = [
        ("Maximize", "⛶"),
        ("Clean Win", "🗖"),
        ("Fullscreen", "⛶"),
        ("PiP", "⧉"),
        ("Download", "📥"),
        ("Tools", "⚙")
    ]
    for idx, (lbl, ic) in enumerate(icons):
        bx = hud_x0 + 10 + idx * 44
        draw.rounded_rectangle([bx, hud_y0 + 6, bx + 36, hud_y0 + 42], radius=8, fill=(30, 41, 59))
        draw.text((bx + 10, hud_y0 + 12), ic, font=font_ui, fill=(241, 245, 249))

    # Expanded Tools Dropdown
    menu_x0, menu_y0, menu_x1, menu_y1 = hud_x0, hud_y1 + 10, hud_x0 + 380, hud_y1 + 380
    draw.rounded_rectangle([menu_x0, menu_y0, menu_x1, menu_y1], radius=14, fill=(15, 23, 42), outline=(99, 102, 241), width=2)

    rows = [
        ("Speed Controls:", ["0.25x", "1.0x", "1.5x", "2.0x", "5.0x"]),
        ("Audio Boost:", ["Normal", "+100%", "+200%", "+300% MAX"]),
        ("Aspect Ratio:", ["Normal", "Zoom Fill", "Ultrawide 21:9", "Stretch"]),
        ("Video Orientation:", ["Mirror / Flip", "Rotate 90°", "Rotate 180°"]),
        ("Media Export:", ["Download Video", "Save Audio M4A", "Capture Frame"])
    ]

    my = menu_y0 + 20
    for title, btns in rows:
        draw.text((menu_x0 + 20, my), title, font=font_ui, fill=(148, 163, 184))
        my += 28
        bx = menu_x0 + 20
        for b in btns:
            bw = len(b) * 9 + 16
            draw.rounded_rectangle([bx, my, bx + bw, my + 26], radius=6, fill=(30, 41, 59), outline=(71, 85, 105), width=1)
            draw.text((bx + 8, my + 4), b, font=font_desc, fill=(241, 245, 249))
            bx += bw + 8
        my += 40

    # Right side callout: Adaptive positioning for YouTube Previews
    c_x0, c_y0, c_x1, c_y1 = vx1 - 420, vy0 + 40, vx1 - 40, vy0 + 260
    draw.rounded_rectangle([c_x0, c_y0, c_x1, c_y1], radius=14, fill=(30, 41, 59), outline=(52, 211, 153), width=2)
    draw.text((c_x0 + 20, c_y0 + 20), "Smart Position Shield", font=font_ui, fill=(52, 211, 153))
    info_lines = [
        "• Automatically moves to TOP-LEFT on YouTube",
        "  feed previews to prevent covering the native",
        "  Mute/Unmute sound button and Subtitles (CC).",
        "",
        "• Stays at TOP-RIGHT on main video players,",
        "  Twitter, Facebook, and Instagram.",
        "",
        "• Gives 100% priority to native player controls."
    ]
    iy = c_y0 + 55
    for l in info_lines:
        draw.text((c_x0 + 20, iy), l, font=font_desc, fill=(226, 232, 240))
        iy += 22

    img.save('store_assets/screenshot-2-floating-hud.png', 'PNG')
    print("Generated store_assets/screenshot-2-floating-hud.png (1280x800)")

def generate_screenshot_3():
    w, h = 1280, 800
    img = Image.new('RGB', (w, h), (15, 23, 42))
    draw = ImageDraw.Draw(img)

    for y in range(120):
        alpha = y / 120.0
        r = int(30 * (1 - alpha) + 15 * alpha)
        g = int(41 * (1 - alpha) + 23 * alpha)
        b = int(59 * (1 - alpha) + 42 * alpha)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    font_title = get_font(40, bold=True)
    font_sub = get_font(20, bold=False)
    font_badge = get_font(16, bold=True)
    font_ui = get_font(18, bold=True)
    font_desc = get_font(15, bold=False)

    draw.text((60, 36), "MaxVideo Pro — Audio Booster & Aspect Ratio", font=font_title, fill=(248, 250, 252))
    draw.text((60, 85), "Turn quiet videos up to 300% volume and adapt video proportions for any monitor or ultrawide screen", font=font_sub, fill=(148, 163, 184))

    draw.rounded_rectangle([1030, 45, 1220, 85], radius=10, fill=(236, 72, 153))
    draw.text((1055, 52), "300% AUDIO BOOST", font=font_badge, fill=(255, 255, 255))

    # 3 Column Cards
    col_w = 360
    col_gap = 40
    start_x = 60

    columns_data = [
        ("Volume Amplifier (300%)", "Web Audio API Gain", [
            "• Boost quiet dialogue and lectures up to 300%",
            "• Clean dynamic amplification with zero distortion",
            "• Works instantly on all HTML5 audio/video streams",
            "• 100% client-side Web Audio processing"
        ], (236, 72, 153)),
        ("Ultrawide & Zoom-to-Fill", "Aspect Ratio Engine", [
            "• Eliminate annoying black bars on 21:9 monitors",
            "• Smart Zoom-to-Fill crops letterboxing seamlessly",
            "• Horizontal Stretch mode for flexible layouts",
            "• Instant hotkey cycling with Alt + Z"
        ], (99, 102, 241)),
        ("Universal Speed Controller", "Playback Modulation", [
            "• Fine-grained speed adjustments from 0.25x to 5.0x",
            "• Quick step shortcuts with [ and ] keys",
            "• Remember playback speed across page reloads",
            "• Preserves natural pitch without audio degradation"
        ], (52, 211, 153))
    ]

    for idx, (c_title, c_sub, items, c_color) in enumerate(columns_data):
        cx0 = start_x + idx * (col_w + col_gap)
        cy0 = 160
        cx1 = cx0 + col_w
        cy1 = 720
        draw.rounded_rectangle([cx0, cy0, cx1, cy1], radius=16, fill=(30, 41, 59), outline=(51, 65, 85), width=2)
        
        # Header bar in card
        draw.rounded_rectangle([cx0 + 2, cy0 + 2, cx1 - 2, cy0 + 90], radius=14, fill=(15, 23, 42))
        draw.rectangle([cx0 + 2, cy0 + 50, cx1 - 2, cy0 + 90], fill=(15, 23, 42))
        draw.text((cx0 + 20, cy0 + 20), c_title, font=font_ui, fill=c_color)
        draw.text((cx0 + 20, cy0 + 50), c_sub, font=font_desc, fill=(148, 163, 184))

        # Graphic box inside card
        gfx_y0 = cy0 + 110
        gfx_y1 = cy0 + 260
        draw.rounded_rectangle([cx0 + 20, gfx_y0, cx1 - 20, gfx_y1], radius=10, fill=(2, 6, 23), outline=c_color, width=1)
        
        # Custom illustration per card
        if idx == 0:
            # Sound wave
            for bar_i in range(12):
                bx = cx0 + 50 + bar_i * 20
                b_h = [20, 45, 70, 95, 110, 85, 105, 120, 80, 50, 30, 15][bar_i]
                draw.rounded_rectangle([bx, gfx_y1 - 15 - b_h, bx + 12, gfx_y1 - 15], radius=4, fill=c_color)
            draw.text((cx0 + 90, gfx_y0 + 15), "300% BOOSTED", font=font_badge, fill=(255, 255, 255))
        elif idx == 1:
            # 21:9 box
            draw.rounded_rectangle([cx0 + 40, gfx_y0 + 35, cx1 - 40, gfx_y1 - 35], radius=6, fill=(15, 23, 42), outline=(255, 255, 255), width=2)
            draw.text((cx0 + 100, gfx_y0 + 60), "21 : 9 PANORAMA", font=font_badge, fill=(255, 255, 255))
        else:
            # Speed gauge
            draw.text((cx0 + 110, gfx_y0 + 45), "2.5x", font=get_font(42, bold=True), fill=c_color)
            draw.text((cx0 + 95, gfx_y0 + 95), "ULTRA SPEED", font=font_badge, fill=(203, 213, 225))

        # Bullet points
        by = gfx_y1 + 30
        for itm in items:
            draw.text((cx0 + 20, by), itm, font=font_desc, fill=(241, 245, 249))
            by += 40

    img.save('store_assets/screenshot-3-player-controls.png', 'PNG')
    print("Generated store_assets/screenshot-3-player-controls.png (1280x800)")

# 3. Small promotional tile (440x280)
def generate_promo_small():
    w, h = 440, 280
    img = Image.new('RGB', (w, h), (15, 23, 42))
    draw = ImageDraw.Draw(img)

    for y in range(h):
        ratio = y / float(h)
        r = int(79 * (1 - ratio) + 15 * ratio)
        g = int(70 * (1 - ratio) + 23 * ratio)
        b = int(229 * (1 - ratio) + 42 * ratio)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    font_title = get_font(28, bold=True)
    font_sub = get_font(14, bold=False)
    font_badge = get_font(12, bold=True)

    # Center Logo icon
    cx, cy = w // 2, 75
    draw.rounded_rectangle([cx - 40, cy - 40, cx + 40, cy + 40], radius=16, fill=(15, 23, 42), outline=(255, 255, 255, 120), width=2)
    draw.polygon([(cx - 10, cy - 16), (cx + 16, cy), (cx - 10, cy + 16)], fill=(255, 255, 255))

    draw.text((w // 2 - 100, 135), "MaxVideo Pro", font=font_title, fill=(255, 255, 255))
    draw.text((w // 2 - 130, 175), "Clean Window Video Maximizer", font=font_sub, fill=(203, 213, 225))

    # Feature tags
    tags = ["Clean Window", "Audio Boost 300%", "Ultrawide 21:9", "PiP Mode"]
    tx = 30
    for t in tags:
        tw = len(t) * 7 + 14
        draw.rounded_rectangle([tx, 220, tx + tw, 245], radius=6, fill=(30, 41, 59, 200), outline=(99, 102, 241), width=1)
        draw.text((tx + 7, 225), t, font=font_badge, fill=(241, 245, 249))
        tx += tw + 10

    img.save('store_assets/promo-small-440x280.png', 'PNG')
    print("Generated store_assets/promo-small-440x280.png (440x280)")

# 4. Large promotional tile (1400x560)
def generate_promo_large():
    w, h = 1400, 560
    img = Image.new('RGB', (w, h), (15, 23, 42))
    draw = ImageDraw.Draw(img)

    for x in range(w):
        ratio = x / float(w)
        r = int(15 * (1 - ratio) + 79 * ratio)
        g = int(23 * (1 - ratio) + 70 * ratio)
        b = int(42 * (1 - ratio) + 229 * ratio)
        draw.line([(x, 0), (x, h)], fill=(r, g, b))

    font_title = get_font(52, bold=True)
    font_sub = get_font(24, bold=False)
    font_badge = get_font(18, bold=True)
    font_item = get_font(20, bold=False)

    # Left content
    draw.text((80, 100), "MaxVideo Pro", font=font_title, fill=(255, 255, 255))
    draw.text((80, 175), "The Ultimate Web Video Maximizer & Clean Window Suite", font=font_sub, fill=(226, 232, 240))

    bullet_y = 240
    bullets = [
        "✓ Clean Window Mode (Alt+W): Hide tabs, URL bar, and bookmarks with 1-click",
        "✓ 300% Audio Boost: Amplify quiet audio dialogue without distortion",
        "✓ Multi-Monitor Multitasking: Snap video side-by-side with your code or notes",
        "✓ Smart HUD & Aspect Ratio: Ultrawide 21:9, Zoom-to-Fill, and 0.25x-5x Speed"
    ]
    for b in bullets:
        draw.text((80, bullet_y), b, font=font_item, fill=(203, 213, 225))
        bullet_y += 45

    # Right Icon Box
    rx0, ry0, rx1, ry1 = 980, 120, 1300, 440
    draw.rounded_rectangle([rx0, ry0, rx1, ry1], radius=32, fill=(15, 23, 42), outline=(255, 255, 255, 140), width=4)
    rcx, rcy = (rx0 + rx1) // 2, (ry0 + ry1) // 2
    draw.polygon([(rcx - 40, rcy - 60), (rcx + 60, rcy), (rcx - 40, rcy + 60)], fill=(255, 255, 255))

    img.save('store_assets/promo-large-1400x560.png', 'PNG')
    print("Generated store_assets/promo-large-1400x560.png (1400x560)")

if __name__ == '__main__':
    generate_icon_300()
    generate_screenshot_1()
    generate_screenshot_2()
    generate_screenshot_3()
    generate_promo_small()
    generate_promo_large()
    print("All store assets generated successfully!")
