// src/services/pincodeLookup.ts
// Public pincode -> district/city/state lookup. No auth, no secret exposure.
// Never blocks the form — on any failure, the artisan just types manually.

export interface PincodeResult {
  district: string;
  city: string;
  state: string;
}

export async function lookupPincode(pincode: string): Promise<PincodeResult | null> {
  if (!/^\d{6}$/.test(pincode)) return null;

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    const data = await res.json();
    const record = data?.[0];
    if (record?.Status !== 'Success' || !record.PostOffice?.length) return null;

    const office = record.PostOffice[0];
    return {
      district: office.District ?? '',
      city: office.Block ?? office.District ?? '',
      state: office.State ?? '',
    };
  } catch {
    return null;
  }
}
