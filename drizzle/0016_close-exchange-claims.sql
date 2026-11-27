GRANT SELECT (family_id, exchange_id), DELETE ON public.claims TO fge_draw;
--> statement-breakpoint
CREATE POLICY closed_exchange_claims ON public.claims AS RESTRICTIVE TO fge_draw
  USING (EXISTS (
    SELECT 1 FROM public.exchanges
    WHERE (exchanges.family_id, exchanges.id) = (claims.family_id, claims.exchange_id)
      AND exchanges.status = 'closed'
  ));
