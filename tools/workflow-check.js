(async () => {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const api = async (path, method = 'GET', body, expected = 200) => {
    const response = await fetch('/api/v1' + path, {
      method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const value = response.status === 204 ? null : await response.json();
    if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, received ${response.status}: ${JSON.stringify(value)}`);
    return value;
  };
  await NRI_DEMO.reset();
  const users = await NRI_DEMO.users();
  const byEmail = email => users.find(user => user.email === email);
  const customer = byEmail('customer@ppo.test');
  const customer2 = byEmail('customer2@ppo.test');
  const operations = byEmail('ops@ppo.test');
  const engineer = byEmail('engineer@ppo.test');
  const representative = byEmail('rep@ppo.test');
  const partner = byEmail('travel@ppo.test');
  const admin = byEmail('super@ppo.test');

  await api('/me', 'GET', undefined, 401);
  await api('/auth/login', 'POST', { email: customer.email, password: 'wrong' }, 401);
  await api('/auth/login', 'POST', { email: customer.email, password: 'Demo@1234' });
  assert((await api('/properties')).length === 3, 'Customer sees only their three seeded properties.');
  await api('/admin/users', 'GET', undefined, 403);
  assert(true, 'Customer cannot access operations user management.');
  await api('/properties', 'POST', { label: '' }, 400);
  const property = await api('/properties', 'POST', {
    label: 'Browser test apartment', type: 'apartment', addressLine1: '12 Sample Road', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600020', accessNotes: 'Sample key instructions',
  }, 201);
  assert(property.customerId === customer.id, 'Property creation derives its owner from the demo session.');
  await api(`/properties/${property.id}`, 'PATCH', { label: 'Updated browser test apartment' });
  await api(`/properties/${property.id}/archive`, 'POST');
  assert((await api('/properties?status=archived')).some(item => item.id === property.id), 'Property archive and archive filter work.');
  await api(`/properties/${property.id}/restore`, 'POST');
  const category = (await api('/service-categories')).find(item => item.kind === 'property');
  const request = await api('/requests', 'POST', {
    propertyId: property.id, categoryId: category.id, title: 'Complete browser workflow', description: 'Check the property and share a report.', priority: 'high', preferredWindow: 'any',
  }, 201);
  assert(request.status === 'submitted', 'New service request begins at submitted.');
  await api(`/properties/${property.id}/archive`, 'POST', undefined, 409);
  assert(true, 'Open requests prevent property archival.');
  await NRI_DEMO.switchPersona(customer2.id);
  await api(`/requests/${request.id}`, 'GET', undefined, 404);
  await api(`/properties/${property.id}`, 'GET', undefined, 404);
  assert(true, 'Another customer cannot read private demo requests or properties.');

  await NRI_DEMO.switchPersona(operations.id);
  await api(`/requests/${request.id}/status-transitions`, 'POST', { to: 'under_review' });
  const assigned = await api(`/requests/${request.id}/assignments`, 'POST', { assigneeId: engineer.id, note: 'Assigned from the prototype test.' });
  assert(assigned.status === 'assigned', 'Operations assignment advances the request to assigned.');
  const visit = await api(`/requests/${request.id}/visits`, 'POST', { scheduledAt: new Date(Date.now() + 3600000).toISOString() }, 201);
  assert((await api(`/requests/${request.id}`)).status === 'scheduled', 'Scheduling a visit advances the request to scheduled.');
  await NRI_DEMO.switchPersona(engineer.id);
  await api(`/visits/${visit.id}`, 'PATCH', { action: 'start' });
  assert((await api(`/requests/${request.id}`)).status === 'in_progress', 'Starting a visit advances the request to in progress.');
  await api(`/visits/${visit.id}`, 'PATCH', { action: 'complete' }, 400);
  assert(true, 'Visit completion requires notes, checklist and photographic evidence.');
  await api(`/requests/${request.id}/comments`, 'POST', { body: 'Work completed; report is ready.' }, 201);
  const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
  const drawing = canvas.getContext('2d'); drawing.fillStyle = '#147d78'; drawing.fillRect(0, 0, 8, 8);
  const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const upload = new FormData(); upload.append('visitId', visit.id); upload.append('files', png, 'proof.png');
  const evidence = await api(`/requests/${request.id}/attachments`, 'POST', upload, 201);
  assert(evidence.length === 1 && evidence[0].url.startsWith('blob:'), 'Photo upload produces a browser-local preview URL.');
  const downloaded = await fetch(`/api/v1/attachments/${evidence[0].id}/file`);
  assert(downloaded.ok && (await downloaded.blob()).size > 0, 'Authorized attachment download returns its stored bytes.');
  await api(`/visits/${visit.id}`, 'PATCH', { action: 'complete', notes: 'Inspection complete. All checklist items passed.', checklist: visit.checklist.map(item => ({ ...item, done: true })) });
  assert((await api(`/requests/${request.id}`)).status === 'completed', 'Completing a valid visit advances the request to completed.');
  await NRI_DEMO.switchPersona(customer.id);
  await api(`/visits/${visit.id}/acknowledge`, 'POST');
  await api(`/requests/${request.id}/status-transitions`, 'POST', { to: 'in_progress', note: 'Please check one more room.' });
  assert((await api(`/requests/${request.id}`)).status === 'in_progress', 'Customer can reopen completed work with a note.');
  await NRI_DEMO.switchPersona(operations.id);
  await api(`/requests/${request.id}/status-transitions`, 'POST', { to: 'completed' });
  await NRI_DEMO.switchPersona(customer.id);
  await api(`/requests/${request.id}/status-transitions`, 'POST', { to: 'closed' });
  const finished = await api(`/requests/${request.id}`);
  assert(finished.status === 'closed' && finished.history.length >= 8, 'Customer closure retains the complete status history.');
  assert(finished.visits[0].customerAcknowledgedAt && finished.comments.length === 1, 'Visit acknowledgment and comments persist.');
  await api(`/requests/${request.id}/status-transitions`, 'POST', { to: 'in_progress', note: 'Invalid terminal transition.' }, 409);

  const invitation = await api(`/properties/${property.id}/authorizations`, 'POST', { inviteeEmail: representative.email, permissions: ['view_requests', 'create_requests', 'comment', 'upload_attachments'] }, 201);
  await NRI_DEMO.switchPersona(representative.id);
  await api(`/authorizations/${invitation.id}/accept`, 'POST');
  const shared = await api(`/properties/${property.id}`);
  assert(shared.property.access === 'representative' && !shared.property.accessNotes, 'Representative access hides property access notes.');
  const repRequest = await api('/requests', 'POST', { propertyId: property.id, categoryId: category.id, title: 'Representative follow-up', description: 'A permitted representative request.' }, 201);
  assert(repRequest.customerId === customer.id && repRequest.requesterId === representative.id, 'Representative requests retain the property owner and actual requester.');
  await NRI_DEMO.switchPersona(customer.id);
  await api(`/properties/${property.id}/authorizations/${invitation.id}`, 'DELETE');
  await NRI_DEMO.switchPersona(representative.id);
  await api(`/properties/${property.id}`, 'GET', undefined, 404);
  assert(true, 'Revocation immediately removes representative visibility.');

  await NRI_DEMO.switchPersona(customer.id);
  const travelCategory = (await api('/service-categories')).find(item => item.kind === 'travel');
  const travel = await api('/requests', 'POST', {
    categoryId: travelCategory.id, propertyId: null, title: 'Airport assistance demo', description: 'Help a sample traveler.',
    travel: { travelerName: 'Sample Traveler', travelPhone: '', travelDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), origin: 'Chennai', destination: 'London', assistanceType: 'senior_assistance' },
  }, 201);
  await NRI_DEMO.switchPersona(operations.id);
  await api(`/requests/${travel.id}/assignments`, 'POST', { assigneeId: partner.id });
  await NRI_DEMO.switchPersona(partner.id);
  await api(`/requests/${travel.id}/status-transitions`, 'POST', { to: 'in_progress' });
  await api(`/requests/${travel.id}/status-transitions`, 'POST', { to: 'completed', note: 'Traveler assistance finished.' });
  assert((await api(`/requests/${travel.id}`)).status === 'completed', 'Travel cases follow their own partner completion workflow.');

  await NRI_DEMO.switchPersona(admin.id);
  const createdUser = await api('/admin/users', 'POST', { name: 'Sample Agent', email: 'sample.agent@example.test', phone: '+91 90000 00000', password: 'Example1234', roles: ['field_engineer'] }, 201);
  await api(`/admin/users/${createdUser.id}`, 'PATCH', { status: 'disabled' });
  const customCategory = await api('/admin/service-categories', 'POST', { key: 'sample-service', name: 'Sample service', kind: 'general', description: 'Prototype category', defaultChecklist: ['Check item'] }, 201);
  await api(`/admin/service-categories/${customCategory.id}`, 'PATCH', { enabled: false });
  await api('/admin/settings', 'PATCH', { visitCompletion: { requirePhoto: false } });
  assert((await api('/admin/settings')).visitCompletion.requirePhoto === false, 'Super admin can update completion settings.');
  assert((await api('/admin/users')).find(item => item.id === createdUser.id).status === 'disabled', 'User administration updates account status.');
  assert((await api('/admin/audit-events')).length > 15, 'Audit events are generated by demo actions.');
  assert((await api('/admin/email-outbox')).length > 0, 'Notification emails are recorded without external delivery.');
  assert((await api('/admin/overview')).totalProperties === 5, 'Operations overview reflects created properties.');

  await api('/auth/logout', 'POST', undefined, 204);
  await api('/auth/signup', 'POST', { name: 'Sample Customer', email: 'sample.customer@example.test', phone: '+91 90000 00001', password: 'Example1234', residenceCountry: 'United Kingdom', acceptTerms: true }, 201);
  const verifyMail = (await NRI_DEMO.inbox()).find(mail => mail.toEmail === 'sample.customer@example.test' && mail.templateKey === 'auth.verify_email');
  assert(verifyMail.link.includes('#/verify-email?token='), 'Verification links use static hash routes.');
  await api('/auth/verify-email', 'POST', { token: verifyMail.link.split('token=')[1] });
  assert((await api('/me')).user.emailVerified, 'Simulated email verification updates the sample account.');
  await api('/auth/forgot-password', 'POST', { email: 'sample.customer@example.test' });
  const resetMail = (await NRI_DEMO.inbox()).find(mail => mail.toEmail === 'sample.customer@example.test' && mail.templateKey === 'auth.reset_password');
  const resetToken = resetMail.link.split('token=')[1];
  await api('/auth/reset-password', 'POST', { token: resetToken, password: 'Changed1234' });
  await api('/me', 'GET', undefined, 401);
  await api('/auth/reset-password', 'POST', { token: resetToken, password: 'Changed1234' }, 400);
  await api('/auth/login', 'POST', { email: 'sample.customer@example.test', password: 'Changed1234' });
  assert(true, 'Password reset invalidates old sessions, rejects token reuse and permits the new password.');
  await api('/me', 'PATCH', { name: 'Updated Sample Customer' });
  assert((await api('/me')).user.name === 'Updated Sample Customer', 'Profile editing saves browser-local account details.');
  const state = JSON.parse(localStorage.getItem('nri-connect-static-prototype.v1'));
  assert(state.collections.service_requests.some(item => item.id === request.id && item.status === 'closed'), 'Closed requests are persisted to browser storage.');
  globalThis.__nriPersistenceId = request.id;
  return `PASS: ${checks.length} workflow assertions\n${checks.join('\n')}`;
})()
