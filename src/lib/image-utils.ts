/**
 * Convertit n'importe quel format image en JPEG via FileReader + canvas.
 * FileReader.readAsDataURL() est plus fiable sur iOS Safari pour HEIC
 * car le navigateur convertit automatiquement en data URL JPEG.
 */
export function convertToJpeg(file: File): Promise<{ file: File; preview: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (!dataUrl) {
        resolve({ file, preview: '' })
        return
      }

      const img = new Image()

      img.onload = () => {
        // Redimensionner si trop grande (max 2048px)
        const MAX = 2048
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round((h / w) * MAX); w = MAX }
          else { w = Math.round((w / h) * MAX); h = MAX }
        }

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve({ file, preview: dataUrl })
          return
        }

        ctx.drawImage(img, 0, 0, w, h)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ file, preview: dataUrl })
              return
            }
            const jpegFile = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
            const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92)
            resolve({ file: jpegFile, preview: jpegDataUrl })
          },
          'image/jpeg',
          0.92
        )
      }

      img.onerror = () => resolve({ file, preview: dataUrl })
      img.src = dataUrl
    }

    reader.onerror = () => resolve({ file, preview: '' })
    reader.readAsDataURL(file)
  })
}
