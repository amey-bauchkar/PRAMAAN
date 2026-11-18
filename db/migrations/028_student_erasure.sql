-- Right to erasure (DPDP Act 2023, section 12): the placement office completes an erasure request with one audited call.
-- It removes what identifies the student or is free text they wrote, and keeps only what the college must keep
-- (de-identified audit entries and aggregate counts). Runs with definer rights so the app role never needs UPDATE on users.
ALTER TABLE students ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION erase_student_data(p_student_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID;
  v_profiles INT; v_accounts INT; v_evidence INT; v_consents INT;
BEGIN
  SELECT user_id INTO v_user FROM students WHERE id = p_student_id AND org_id = current_app_org_id();
  IF v_user IS NULL THEN RAISE EXCEPTION 'STUDENT_NOT_IN_TENANT'; END IF;

  UPDATE consent_grants SET revoked_at = now() WHERE student_id = p_student_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_consents = ROW_COUNT;
  DELETE FROM external_profiles WHERE student_id = p_student_id;           GET DIAGNOSTICS v_profiles = ROW_COUNT;
  DELETE FROM connected_accounts WHERE student_id = p_student_id;          GET DIAGNOSTICS v_accounts = ROW_COUNT;
  UPDATE evidence_items SET status = 'withdrawn', description = NULL, review_note = NULL, object_key = NULL WHERE student_id = p_student_id;
  GET DIAGNOSTICS v_evidence = ROW_COUNT;
  UPDATE mock_review_requests SET reason = '[erased by request]', decision_note = NULL WHERE student_id = p_student_id;
  UPDATE eligibility_appeals SET reason = '[erased by request]', decision_note = CASE WHEN decision_note IS NULL THEN NULL ELSE '[erased by request]' END WHERE student_id = p_student_id;
  UPDATE data_requests SET exception_note = NULL WHERE student_id = p_student_id;
  UPDATE users SET full_name = 'Erased student', email = 'erased-' || id::text || '@erased.invalid', auth_subject = 'erased|' || id::text WHERE id = v_user;
  UPDATE students SET erased_at = now() WHERE id = p_student_id;

  RETURN jsonb_build_object('consentsRevoked', v_consents, 'externalProfiles', v_profiles, 'connectedAccounts', v_accounts, 'evidenceItems', v_evidence);
END $$;
REVOKE ALL ON FUNCTION erase_student_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_student_data(UUID) TO app_api;
