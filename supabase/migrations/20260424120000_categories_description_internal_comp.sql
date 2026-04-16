ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS title text;

UPDATE public.categories
SET code = name
WHERE code IS NULL OR BTRIM(code) = '';

UPDATE public.categories
SET title = name
WHERE title IS NULL OR BTRIM(title) = '';

UPDATE public.categories
SET description = $desc$
Successful participation in internal competitions aimed at developing students' practical skills (MS Office skills, AI prompt engineering, communication, leadership, presentation, pitching, speed typing, etc.)

Based on the results:
• 1st place — 5 points
• 2nd place — 4 points
• 3rd place — 3 points
$desc$
WHERE name = 'internal_competitions';
