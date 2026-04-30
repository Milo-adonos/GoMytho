-- Exécuter dans Supabase : SQL Editor → New query → Run
-- (Panel admin → « Masquer » un utilisateur sans supprimer le compte.)
--
-- Pas de clé étrangère vers public.users : ce script doit marcher même si
-- tu n’as pas encore appliqué tout supabase-schema.sql. Pour GoMytho en prod,
-- exécute idéalement le schéma complet une fois (users, mythos, etc.).
--
-- Optionnel (après création de public.users) :
--   ALTER TABLE public.admin_panel_exclusions
--     ADD CONSTRAINT admin_panel_exclusions_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.admin_panel_exclusions (
    email_norm TEXT PRIMARY KEY,
    user_id UUID,
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_panel_exclusions_user_id
    ON public.admin_panel_exclusions(user_id);

COMMENT ON TABLE public.admin_panel_exclusions IS
    'Comptes exclus du panel admin (stats, analyses, liste utilisateurs) ; les données restent en base.';

NOTIFY pgrst, 'reload schema';
