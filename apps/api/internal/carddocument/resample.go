package carddocument

import (
	"image"
	"image/draw"
)

// shrinkBand is how many source rows are converted to RGBA at a time.
const shrinkBand = 16

// shrink resamples src into dst, which must be no larger in either dimension,
// by averaging the source area each destination pixel covers. Source rows are
// converted a band at a time, so besides dst it holds a few rows whatever the
// source size. A kernel scaler such as CatmullRom instead allocates 32 bytes
// for every destination column of every source row.
func shrink(dst *image.RGBA, src image.Image) {
	sb, db := src.Bounds(), dst.Bounds()
	sw, sh, dw, dh := sb.Dx(), sb.Dy(), db.Dx(), db.Dy()
	if sw == dw && sh == dh {
		draw.Draw(dst, db, src, sb.Min, draw.Src)
		return
	}
	columns := spans(sw, dw)
	rows := spans(sh, dh)
	band := image.NewRGBA(image.Rect(0, 0, sw, shrinkBand))
	line := make([]float32, dw*4)
	// The source row being read adds to the destination row it starts in and,
	// when it straddles a boundary, to the next one.
	current, next := make([]float32, dw*4), make([]float32, dw*4)
	row := 0
	for top := 0; top < sh; top += shrinkBand {
		height := min(shrinkBand, sh-top)
		draw.Draw(band, image.Rect(0, 0, sw, height), src, image.Pt(sb.Min.X, sb.Min.Y+top), draw.Src)
		for y := range height {
			clear(line)
			pixels := band.Pix[y*band.Stride : y*band.Stride+sw*4]
			for x, span := range columns {
				r, g, b, a := float32(pixels[x*4]), float32(pixels[x*4+1]), float32(pixels[x*4+2]), float32(pixels[x*4+3])
				at := span.index * 4
				line[at] += r * span.first
				line[at+1] += g * span.first
				line[at+2] += b * span.first
				line[at+3] += a * span.first
				if span.second > 0 {
					line[at+4] += r * span.second
					line[at+5] += g * span.second
					line[at+6] += b * span.second
					line[at+7] += a * span.second
				}
			}
			span := rows[top+y]
			for index, value := range line {
				current[index] += value * span.first
			}
			if span.second > 0 {
				for index, value := range line {
					next[index] += value * span.second
				}
			}
			// The row is complete once the source has moved past it.
			if top+y == sh-1 || rows[top+y+1].index != row {
				writeRow(dst, row, current)
				current, next = next, current
				clear(next)
				row++
			}
		}
	}
}

// span is where one source column or row lands: a share of destination pixel
// index, and the rest of it in the pixel after.
type span struct {
	index         int
	first, second float32
}

// spans maps each of size source pixels onto out destination pixels, with
// shares measured in destination pixels so each destination pixel's shares
// add up to one.
func spans(size, out int) []span {
	result := make([]span, size)
	scale := float64(out) / float64(size)
	for at := range size {
		start, end := float64(at)*scale, float64(at+1)*scale
		index := min(int(start), out-1)
		boundary := float64(index + 1)
		if end > boundary && index+1 < out {
			result[at] = span{index: index, first: float32(boundary - start), second: float32(end - boundary)}
		} else {
			result[at] = span{index: index, first: float32(end - start)}
		}
	}
	return result
}

// writeRow stores one destination row of premultiplied sums, rounded.
func writeRow(dst *image.RGBA, y int, sums []float32) {
	offset := dst.PixOffset(dst.Rect.Min.X, dst.Rect.Min.Y+y)
	for index, value := range sums {
		dst.Pix[offset+index] = clampByte(value)
	}
}

func clampByte(value float32) uint8 {
	value += 0.5
	if value <= 0 {
		return 0
	}
	if value >= 255 {
		return 255
	}
	return uint8(value)
}
