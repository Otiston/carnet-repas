-- Photos de la balance : maintenant qu'elles sont recadrées sur l'écran (ni pieds ni sol),
-- elles deviennent lisibles par tous, comme les photos de repas. L'envoi et la suppression
-- restent réservés au propriétaire (règles « pesees: owner insert/delete »).
update storage.buckets set public = true where id = 'pesees';
