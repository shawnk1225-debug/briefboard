const MAX_EDGE = 2000

export interface PreparedImage {
  blob: Blob
  extension: string
  aspect: number
}

// Shrinks uploads to stretch free storage. GIFs are left alone to keep their animation.
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const aspect = width / height
  if (file.type === 'image/gif') {
    bitmap.close()
    return { blob: file, extension: 'gif', aspect }
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  // Keep whichever is smaller; Safari may also fall back to PNG here, which is fine.
  if (!blob || (scale === 1 && file.size <= blob.size)) {
    return { blob: file, extension: file.type.split('/')[1] || 'png', aspect }
  }
  return { blob, extension: blob.type.split('/')[1] || 'webp', aspect }
}
