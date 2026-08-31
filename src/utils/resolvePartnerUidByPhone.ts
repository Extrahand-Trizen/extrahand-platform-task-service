import mongoose from 'mongoose';

export function normalizeIndianPhoneLast10(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 10) return digits;
  return digits.slice(-10);
}

/** Resolve approved partner Firebase uid by phone (last 10 digits). */
export async function resolvePartnerUidByPhone(phone: string): Promise<string | null> {
  const last10 = normalizeIndianPhoneLast10(phone);
  if (last10.length !== 10) return null;

  const Profile = mongoose.connection.collection('profiles');
  const profile = await Profile.findOne({
    isActive: true,
    'partnerProfile.status': 'approved',
    $or: [
      { phone: { $regex: `${last10}$` } },
      { phoneNumber: { $regex: `${last10}$` } },
      { mobile: { $regex: `${last10}$` } },
    ],
  });

  const uid = String(profile?.uid || '').trim();
  return uid || null;
}
