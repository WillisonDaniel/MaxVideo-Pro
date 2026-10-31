import os
from PIL import Image, ImageDraw

def create_icons():
    os.makedirs('icons', exist_ok=True)
    sizes = [16, 32, 48, 128]

    for size in sizes:
        # Create image with RGBA
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Scale factor
        s = size / 128.0

        # Background rounded rectangle with gradient effect
        # Create high-res or draw smooth background
        radius = int(28 * s)
        margin = max(1, int(4 * s))
        
        # Base rounded box (gradient from Indigo to Violet)
        # We can draw layered rounded rectangles for a smooth gradient
        steps = 40
        for i in range(steps):
            ratio = i / float(steps)
            # Gradient: #4F46E5 (79, 70, 229) to #9333EA (147, 51, 234)
            r = int(79 * (1 - ratio) + 147 * ratio)
            g = int(70 * (1 - ratio) + 51 * ratio)
            b = int(229 * (1 - ratio) + 234 * ratio)
            
            inset_top = margin + int((size - 2 * margin) * (i / float(steps)))
            inset_bottom = margin + int((size - 2 * margin) * ((i + 1) / float(steps)))
            
            # Mask layer
            mask_layer = Image.new('L', (size, size), 0)
            mask_draw = ImageDraw.Draw(mask_layer)
            mask_draw.rounded_rectangle(
                [margin, margin, size - margin, size - margin],
                radius=radius,
                fill=255
            )
            
            # Slice image
            slice_img = Image.new('RGBA', (size, size), (r, g, b, 255))
            
            # Crop to current vertical stripe
            stripe_mask = Image.new('L', (size, size), 0)
            stripe_draw = ImageDraw.Draw(stripe_mask)
            stripe_draw.rectangle([0, inset_top, size, inset_bottom], fill=255)
            
            combined_mask = Image.new('L', (size, size), 0)
            # Combine mask
            for y in range(inset_top, min(inset_bottom, size)):
                for x in range(size):
                    if mask_layer.getpixel((x, y)) > 0:
                        combined_mask.putpixel((x, y), 255)
            
            img.paste(slice_img, (0, 0), combined_mask)

        # Draw border
        border_draw = ImageDraw.Draw(img)
        border_draw.rounded_rectangle(
            [margin, margin, size - margin, size - margin],
            radius=radius,
            outline=(255, 255, 255, 60),
            width=max(1, int(2 * s))
        )

        # Draw Center Elements: Play triangle + 4 corner maximize brackets
        # Center Play icon:
        cx, cy = size / 2.0, size / 2.0
        p_size = 18 * s
        play_poly = [
            (cx - p_size * 0.7, cy - p_size),
            (cx + p_size * 1.1, cy),
            (cx - p_size * 0.7, cy + p_size)
        ]
        border_draw.polygon(play_poly, fill=(255, 255, 255, 240))

        # 4 Corner brackets (Maximize indicator)
        b_margin = 18 * s
        b_len = 16 * s
        b_w = max(1, int(4 * s))

        # Top-Left
        border_draw.line([(b_margin, b_margin + b_len), (b_margin, b_margin), (b_margin + b_len, b_margin)], fill=(255, 255, 255, 230), width=b_w)
        # Top-Right
        border_draw.line([(size - b_margin - b_len, b_margin), (size - b_margin, b_margin), (size - b_margin, b_margin + b_len)], fill=(255, 255, 255, 230), width=b_w)
        # Bottom-Left
        border_draw.line([(b_margin, size - b_margin - b_len), (b_margin, size - b_margin), (b_margin + b_len, size - b_margin)], fill=(255, 255, 255, 230), width=b_w)
        # Bottom-Right
        border_draw.line([(size - b_margin - b_len, size - b_margin), (size - b_margin, size - b_margin), (size - b_margin, size - b_margin - b_len)], fill=(255, 255, 255, 230), width=b_w)

        img.save(f'icons/icon-{size}.png', 'PNG')
        print(f"Generated icons/icon-{size}.png ({size}x{size})")

if __name__ == '__main__':
    create_icons()
