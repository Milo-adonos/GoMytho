/**
 * Convertit n'importe quel format image (HEIC, HEIF, WebP, etc.)
 * en JPEG via un canvas HTML.
 * Safari iOS convertit automatiquement HEIC → bitmap lors du chargement
 * dans un <img>, ce qui permet l'export en JPEG.
 */
export function convertToJpeg(file: File): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Limiter à 2048px max pour éviter les fichiers trop lourds
      const MAX = 2048
      let { naturalWidth: w, naturalHeight: h } = img
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round((h / w) * MAX); w = MAX }
        else { w = Math.round((w / h) * MAX); h = MAX }
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }

      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return }
          resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.92
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // fallback : envoyer le fichier original
    }

    img.src = url
  })
}
