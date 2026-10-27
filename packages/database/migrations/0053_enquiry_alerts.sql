-- Telling managers when an enquiry arrives from the website, and the kind of
-- notification that says "a job was given to you" under the name the code has
-- used since tasks were renamed projects (0028): the constraint still said
-- 'task_assigned', so that notification would have been refused.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_known;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_known CHECK (kind IN (
  'document_expiring', 'deadline_near', 'task_assigned', 'project_assigned',
  'escalation', 'time_needs_review', 'new_enquiry'
));

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_kind_known;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_kind_known CHECK (kind IN (
  'document_expiring', 'deadline_near', 'task_assigned', 'project_assigned',
  'escalation', 'time_needs_review', 'new_enquiry'
));
