// Compteur pseudo-aléatoire mais déterministe par jour.
// Sert à afficher la même valeur (« X mythos aujourd'hui ») partout dans
// l'app — landing + page Choix offre — pour que ça reste cohérent.
//
// Le seed change chaque jour à 15h heure française (UTC+2 en été). Avant
// 15h, on garde le seed de la veille pour éviter qu'un visiteur du matin
// voie un compteur reset à 0 puis remonter.
export function getDailyMythoCount(): number {
  const now = new Date()
  const frenchHour = (now.getUTCHours() + 2) % 24
  const seedDate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      frenchHour < 15 ? now.getUTCDate() - 1 : now.getUTCDate(),
    ),
  )
  const seed =
    seedDate.getUTCFullYear() * 10000 +
    (seedDate.getUTCMonth() + 1) * 100 +
    seedDate.getUTCDate()
  const rand = ((seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff
  return Math.floor(938 + rand * (2371 - 938 + 1))
}
