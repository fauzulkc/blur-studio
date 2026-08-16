#!/usr/bin/env python3
"""
Image Blur Studio - Core Python Processing Engine.
Applies Gaussian blur with soft feathering to specified areas (ellipses, rects, and grid tiles)
while preserving VIP subjects 100% sharp using exclusion bounding boxes.
"""

import os
import sys
import json
import argparse
import glob
from PIL import Image, ImageFilter, ImageDraw, ImageOps
import numpy as np

def process_single_image(input_path, output_path, targets=None, exclusion_boxes=None,
                         blur_radius=13.0, feather_radius=14.0, make_backup=False):
    """
    Processes a single image file with face/grid targets and VIP exclusion boxes.
    
    targets: list of [cx, cy, rx, ry] or dicts {cx, cy, rx, ry} or rects {x1, y1, x2, y2}
    exclusion_boxes: list of [x1, y1, x2, y2] (normalized 0.0 - 1.0)
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")
    
    if targets is None:
        targets = []
    if exclusion_boxes is None:
        exclusion_boxes = []
        
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    # If in-place replacement and backup requested
    if os.path.abspath(input_path) == os.path.abspath(output_path) and make_backup:
        backup_path = input_path + ".bak"
        if not os.path.exists(backup_path):
            with open(input_path, 'rb') as src, open(backup_path, 'wb') as dst:
                dst.write(src.read())

    # Open and correct EXIF orientation
    with Image.open(input_path) as raw_img:
        orig_img = ImageOps.exif_transpose(raw_img).convert("RGB")
    
    w, h = orig_img.size
    
    if not targets and not exclusion_boxes:
        # No blur needed, just save copy if different path
        if os.path.abspath(input_path) != os.path.abspath(output_path):
            orig_img.save(output_path, quality=95)
        return {
            "success": True,
            "image": os.path.basename(input_path),
            "targets_count": 0,
            "output": output_path
        }
    
    # 1. Create 8-bit grayscale mask for blur targets
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    
    for t in targets:
        if isinstance(t, dict):
            # Check if rectangular / grid cell target
            if 'x1' in t and 'x2' in t:
                x1 = int(float(t['x1']) * w)
                y1 = int(float(t['y1']) * h)
                x2 = int(float(t['x2']) * w)
                y2 = int(float(t['y2']) * h)
                draw.rectangle([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)], fill=255)
            else:
                cx_r = float(t.get('cx', 0))
                cy_r = float(t.get('cy', 0))
                rx_r = float(t.get('rx', 0.03))
                ry_r = float(t.get('ry', 0.04))
                
                cx, cy = int(cx_r * w), int(cy_r * h)
                rx, ry = max(2, int(rx_r * w)), max(2, int(ry_r * h))
                draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
        elif isinstance(t, (list, tuple)):
            if len(t) == 4:
                # [cx, cy, rx, ry]
                cx, cy = int(float(t[0]) * w), int(float(t[1]) * h)
                rx, ry = max(2, int(float(t[2]) * w)), max(2, int(float(t[3]) * h))
                draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
                
    # 2. Punch out VIP exclusion boxes (100% sharp subject protection)
    if exclusion_boxes:
        pmask = Image.new('L', (w, h), 0)
        pdraw = ImageDraw.Draw(pmask)
        
        for box in exclusion_boxes:
            if isinstance(box, dict):
                x1_r = float(box.get('x1', 0))
                y1_r = float(box.get('y1', 0))
                x2_r = float(box.get('x2', 0))
                y2_r = float(box.get('y2', 0))
            else:
                x1_r, y1_r, x2_r, y2_r = float(box[0]), float(box[1]), float(box[2]), float(box[3])
                
            x1, y1 = int(x1_r * w), int(y1_r * h)
            x2, y2 = int(x2_r * w), int(y2_r * h)
            pdraw.rectangle([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)], fill=255)
            
        mask_np = np.array(mask)
        p_np = np.array(pmask)
        mask_np[p_np == 255] = 0
        mask = Image.fromarray(mask_np)
        
    # 3. Apply Gaussian blur to the full original image
    blurred_img = orig_img.filter(ImageFilter.GaussianBlur(radius=float(blur_radius)))
    
    # 4. Feather the mask edges smoothly
    if float(feather_radius) > 0:
        mask_feathered = mask.filter(ImageFilter.GaussianBlur(radius=float(feather_radius)))
    else:
        mask_feathered = mask
        
    # 5. Composite sharp image with blurred version based on mask
    final_img = Image.composite(blurred_img, orig_img, mask_feathered)
    
    # Determine output format and quality
    ext = os.path.splitext(output_path)[1].lower()
    if ext in ['.jpg', '.jpeg']:
        final_img.save(output_path, 'JPEG', quality=95, optimize=True)
    elif ext == '.png':
        final_img.save(output_path, 'PNG', optimize=True)
    elif ext == '.webp':
        final_img.save(output_path, 'WEBP', quality=95)
    else:
        final_img.save(output_path, quality=95)
        
    return {
        "success": True,
        "image": os.path.basename(input_path),
        "targets_count": len(targets),
        "exclusions_count": len(exclusion_boxes),
        "output": output_path
    }

def main():
    parser = argparse.ArgumentParser(description="Image Blur Studio Processor")
    parser.add_argument("--json", type=str, help="JSON input string or JSON file path with batch instructions")
    parser.add_argument("--input", type=str, help="Input image path")
    parser.add_argument("--output", type=str, help="Output image path")
    parser.add_argument("--blur-radius", type=float, default=13.0, help="Gaussian blur radius (default: 13.0)")
    parser.add_argument("--feather-radius", type=float, default=14.0, help="Soft feather radius (default: 14.0)")
    parser.add_argument("--backup", action="store_true", help="Create backup when overwriting")
    
    args = parser.parse_args()
    
    if args.json:
        if os.path.exists(args.json):
            with open(args.json, 'r') as f:
                data = json.load(f)
        else:
            data = json.loads(args.json)
            
        results = []
        blur_radius = float(data.get("blurRadius", 13.0))
        feather_radius = float(data.get("featherRadius", 14.0))
        make_backup = bool(data.get("backup", False))
        
        items = data.get("items", [])
        for item in items:
            in_p = item.get("inputPath")
            out_p = item.get("outputPath", in_p)
            targets = item.get("targets", [])
            exclusions = item.get("exclusions", [])
            
            try:
                res = process_single_image(
                    in_p, out_p, targets, exclusions,
                    blur_radius=blur_radius,
                    feather_radius=feather_radius,
                    make_backup=make_backup
                )
                results.append(res)
            except Exception as e:
                results.append({
                    "success": False,
                    "image": os.path.basename(in_p),
                    "error": str(e)
                })
                
        print(json.dumps({"success": True, "processed": results}))
        return

    if args.input and args.output:
        res = process_single_image(
            args.input, args.output,
            blur_radius=args.blur_radius,
            feather_radius=args.feather_radius,
            make_backup=args.backup
        )
        print(json.dumps(res))
        return

    parser.print_help()

if __name__ == "__main__":
    main()
