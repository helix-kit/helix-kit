import { redirect } from 'next/navigation';

// `/admin` has no page of its own — landing here should send an admin to the first
// real section rather than 404. This lives inside the (dashboard) group, so the parent
// layout has already gated it to authenticated admins (non-admins are redirected to
// /auth/login by that layout before this runs).
const AdminIndexPage = () => {
  redirect('/admin/devices');
};

export default AdminIndexPage;
