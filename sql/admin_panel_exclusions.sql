-- Exécuter dans Supabase : SQL Editor → New query → Run
-- (Panel admin → « Masquer » un utilisateur sans supprimer le compte.)

CREATE TABLE IF NOT EXISTS public.admin_panel_exclusions (
    email_norm TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_panel_exclusions_user_id
    ON public.admin_panel_exclusions(user_id);

COMMENT ON TABLE public.admin_panel_exclusions IS
    'Comptes exclus du panel admin (stats, analyses, liste utilisateurs) ; les données restent en base.';

-- Recharge le cache schéma de PostgREST (évite parfois l’erreur « not in schema cache » juste après création)
NOTIFY pgrst, 'reload schema';
