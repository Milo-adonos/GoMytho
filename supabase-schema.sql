-- GoMytho - Supabase Database Schema
-- Exécuter ce script dans l'éditeur SQL de Supabase

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table users
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'cancelled')),
    credits_remaining INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table mythos
CREATE TABLE IF NOT EXISTS public.mythos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    prompt TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS mythos_user_id_idx ON public.mythos(user_id);
CREATE INDEX IF NOT EXISTS mythos_created_at_idx ON public.mythos(created_at DESC);

-- Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mythos ENABLE ROW LEVEL SECURITY;

-- Policies pour users
CREATE POLICY "Users can view their own data"
    ON public.users
    FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own data"
    ON public.users
    FOR UPDATE
    USING (auth.uid() = id);

-- Policies pour mythos
CREATE POLICY "Users can view their own mythos"
    ON public.mythos
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own mythos"
    ON public.mythos
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own mythos"
    ON public.mythos
    FOR DELETE
    USING (auth.uid() = user_id);

-- Storage bucket pour les images
-- À créer manuellement dans l'interface Supabase Storage :
-- 1. Créer un bucket nommé "mythos"
-- 2. Le rendre public
-- 3. Configurer les policies suivantes :

-- Policy pour upload (INSERT)
-- Autoriser les utilisateurs authentifiés à uploader dans leur propre dossier
-- Pattern: {user_id}/*

-- Policy pour lecture (SELECT)
-- Autoriser tout le monde à lire les images publiques

-- Policy pour suppression (DELETE)
-- Autoriser les utilisateurs à supprimer uniquement leurs propres images

-- Fonction pour nettoyer les anciennes images (optionnel, à scheduler)
CREATE OR REPLACE FUNCTION clean_old_mythos()
RETURNS void AS $$
BEGIN
    DELETE FROM public.mythos
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger pour créer automatiquement un user record après signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, credits_remaining)
    VALUES (NEW.id, NEW.email, 0);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Vue pour les statistiques (optionnel)
CREATE OR REPLACE VIEW public.user_stats AS
SELECT
    u.id,
    u.email,
    u.credits_remaining,
    COUNT(m.id) AS total_mythos,
    MAX(m.created_at) AS last_mytho_created
FROM public.users u
LEFT JOIN public.mythos m ON u.id = m.user_id
GROUP BY u.id, u.email, u.credits_remaining;
