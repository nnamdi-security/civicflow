-- status_events is append-only: reject UPDATE and DELETE.
-- TRUNCATE is deliberately not blocked so test databases can be reset; it needs table-owner
-- privileges, which the application role must not have in production.
CREATE FUNCTION status_events_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'status_events is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER status_events_append_only
	BEFORE UPDATE OR DELETE ON status_events
	FOR EACH ROW EXECUTE FUNCTION status_events_reject_change();--> statement-breakpoint

-- Reference data: the six launch categories (docs/product.md). SLA policy arrives in Phase 5.
INSERT INTO categories (slug, name, default_agency_type, sort_order) VALUES
	('roads', 'Roads and potholes', 'roads', 10),
	('drainage', 'Drainage and flooding', 'drainage', 20),
	('water', 'Water supply', 'water', 30),
	('power', 'Power and electricity', 'power', 40),
	('waste', 'Waste and sanitation', 'waste', 50),
	('streetlights', 'Streetlights', 'streetlights', 60)
ON CONFLICT (slug) DO NOTHING;
