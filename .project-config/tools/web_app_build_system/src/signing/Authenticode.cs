using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;

public static class BuildAuthenticode {
    const string Sha256 = "2.16.840.1.101.3.4.2.1";
    [StructLayout(LayoutKind.Sequential)] struct Blob { public uint Size; public IntPtr Data; }
    [StructLayout(LayoutKind.Sequential)] struct Algorithm { public IntPtr Oid; public Blob Parameters; }
    [StructLayout(LayoutKind.Sequential)] struct Attribute { public IntPtr Oid; public Blob Value; }
    [StructLayout(LayoutKind.Sequential)] struct Indirect { public Attribute Data; public Algorithm Algorithm; public Blob Digest; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Subject {
        public uint Size; public IntPtr Type, File;
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        public IntPtr Display; public uint Reserved1, Version; public IntPtr Provider;
        public Algorithm Algorithm; public uint Flags, Encoding, Reserved2, Capi, Security, Index, Choice;
        public IntPtr Union, Client;
    }
    [StructLayout(LayoutKind.Sequential)] struct TimestampContext { public uint Size; public IntPtr Encoded, Info; }
    [StructLayout(LayoutKind.Sequential)] struct TimestampInfo {
        public uint Version; public IntPtr Policy; public Algorithm Algorithm; public Blob Imprint, Serial;
        public System.Runtime.InteropServices.ComTypes.FILETIME Time;
    }
    [DllImport("crypt32.dll", SetLastError=true)] static extern bool CryptDecodeObjectEx(uint encoding, string type, byte[] bytes, uint size, uint flags, IntPtr para, out IntPtr output, ref uint outputSize);
    [DllImport("crypt32.dll", SetLastError=true)] static extern bool CryptVerifyTimeStampSignature(byte[] token, uint tokenSize, byte[] data, uint size, IntPtr store, out IntPtr context, out IntPtr signer, out IntPtr extra);
    [DllImport("crypt32.dll")] static extern void CryptMemFree(IntPtr value);
    [DllImport("crypt32.dll")] static extern bool CertFreeCertificateContext(IntPtr value);
    [DllImport("crypt32.dll")] static extern bool CertCloseStore(IntPtr value, uint flags);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("crypt32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CryptSIPRetrieveSubjectGuid(string file, IntPtr handle, out Guid type);
    [DllImport("crypt32.dll", SetLastError=true)] static extern bool CryptSIPVerifyIndirectData(ref Subject subject, IntPtr indirect);

    static void Require(bool result, string message) { if (!result) throw new CryptographicException(message); }
    static byte[] Embedded(byte[] pe) {
        Require(pe.Length >= 512 && BitConverter.ToUInt16(pe, 0) == 0x5a4d, "Not a PE file.");
        int header = BitConverter.ToInt32(pe, 0x3c);
        Require(header >= 64 && header <= pe.Length - 256 && BitConverter.ToUInt32(pe, header) == 0x4550, "Invalid PE header.");
        int optional = header + 24;
        ushort magic = BitConverter.ToUInt16(pe, optional);
        Require(magic == 0x20b || magic == 0x10b, "Unsupported PE optional header.");
        int directory = optional + (magic == 0x20b ? 112 : 96) + 32;
        uint offset = BitConverter.ToUInt32(pe, directory), size = BitConverter.ToUInt32(pe, directory + 4);
        Require(offset > 0 && size >= 8 && offset <= pe.Length - size && size <= 1048576, "Missing or invalid embedded signature.");
        uint length = BitConverter.ToUInt32(pe, (int)offset);
        Require(length >= 8 && length <= size && ((length + 7) & ~7u) == size
            && BitConverter.ToUInt16(pe, (int)offset + 4) == 0x200
            && BitConverter.ToUInt16(pe, (int)offset + 6) == 2, "Unsupported or multiple embedded signatures.");
        byte[] cms = new byte[length - 8]; Buffer.BlockCopy(pe, (int)offset + 8, cms, 0, cms.Length); return cms;
    }
    static void VerifySubject(string file, byte[] content) {
        IntPtr indirect = IntPtr.Zero, guidPointer = IntPtr.Zero;
        try {
            uint size = 0;
            Require(CryptDecodeObjectEx(0x10001, "1.3.6.1.4.1.311.2.1.4", content, (uint)content.Length, 0x8000, IntPtr.Zero, out indirect, ref size), "Cannot decode Authenticode indirect data.");
            Indirect data = (Indirect)Marshal.PtrToStructure(indirect, typeof(Indirect));
            Require(Marshal.PtrToStringAnsi(data.Algorithm.Oid) == Sha256, "PE digest must be SHA-256.");
            Guid guid;
            Require(CryptSIPRetrieveSubjectGuid(file, IntPtr.Zero, out guid), "No Windows PE SIP provider.");
            guidPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Guid))); Marshal.StructureToPtr(guid, guidPointer, false);
            Subject subject = new Subject { Size=(uint)Marshal.SizeOf(typeof(Subject)), Type=guidPointer, Name=file,
                Algorithm=data.Algorithm, Encoding=0x10001 };
            Require(CryptSIPVerifyIndirectData(ref subject, indirect), "Authenticode PE digest mismatch.");
        } finally { if (indirect != IntPtr.Zero) LocalFree(indirect); if (guidPointer != IntPtr.Zero) Marshal.FreeHGlobal(guidPointer); }
    }
    static string VerifyTimestamp(SignerInfo signer, byte[] signature) {
        byte[] token = null;
        foreach (CryptographicAttributeObject attr in signer.UnsignedAttributes) {
            Require(attr.Oid.Value != "1.3.6.1.4.1.311.2.4.1", "Nested signatures are unsupported.");
            if (attr.Oid.Value == "1.3.6.1.4.1.311.3.3.1") {
                Require(token == null && attr.Values.Count == 1, "Ambiguous RFC 3161 timestamp."); token = attr.Values[0].RawData;
            }
        }
        Require(token != null, "Required RFC 3161 timestamp is missing.");
        IntPtr context = IntPtr.Zero, tsa = IntPtr.Zero, store = IntPtr.Zero;
        try {
            Require(CryptVerifyTimeStampSignature(token, (uint)token.Length, signature, (uint)signature.Length,
                IntPtr.Zero, out context, out tsa, out store), "RFC 3161 signature/imprint verification failed.");
            TimestampContext result = (TimestampContext)Marshal.PtrToStructure(context, typeof(TimestampContext));
            TimestampInfo info = (TimestampInfo)Marshal.PtrToStructure(result.Info, typeof(TimestampInfo));
            Require(Marshal.PtrToStringAnsi(info.Algorithm.Oid) == Sha256, "Timestamp imprint must be SHA-256.");
            long ticks = ((long)info.Time.dwHighDateTime << 32) | (uint)info.Time.dwLowDateTime;
            return DateTime.FromFileTimeUtc(ticks).ToString("o");
        } finally { if (context != IntPtr.Zero) CryptMemFree(context); if (tsa != IntPtr.Zero) CertFreeCertificateContext(tsa); if (store != IntPtr.Zero) CertCloseStore(store, 0); }
    }
    // Parse DER boundaries only; SignedCms verifies the message and signed attributes.
    struct Der { public int Tag, Start, End; }
    static Der Read(byte[] bytes, ref int offset) {
        Require(offset + 2 <= bytes.Length, "Truncated DER.");
        int tag = bytes[offset++], length = bytes[offset++];
        if (length >= 128) {
            int count = length & 127; Require(count > 0 && count <= 4 && offset + count <= bytes.Length, "Invalid DER length.");
            length = 0; for (int n=0;n<count;n++) length = checked((length << 8) | bytes[offset++]);
        }
        Require(length >= 0 && length <= bytes.Length - offset, "Invalid DER boundary.");
        Der result = new Der { Tag=tag, Start=offset, End=offset+length }; offset += length; return result;
    }
    static byte[] ExtractSignature(byte[] bytes) {
        int at=0; Der root=Read(bytes, ref at); at=root.Start;
        Read(bytes, ref at); Der wrapper=Read(bytes, ref at); at=wrapper.Start;
        Der signed=Read(bytes, ref at); at=signed.Start;
        Read(bytes, ref at); Read(bytes, ref at); Read(bytes, ref at);
        Der next=Read(bytes, ref at);
        while (next.Tag == 0xa0 || next.Tag == 0xa1) next=Read(bytes, ref at);
        Require(next.Tag == 0x31, "Missing signer set."); at=next.Start;
        Der signer=Read(bytes, ref at); Require(at == next.End, "Multiple signers are unsupported."); at=signer.Start;
        Read(bytes, ref at); Read(bytes, ref at); Read(bytes, ref at); next=Read(bytes, ref at);
        if (next.Tag == 0xa0) next=Read(bytes, ref at);
        Require(next.Tag == 0x30, "Missing signature algorithm."); next=Read(bytes, ref at);
        Require(next.Tag == 4, "Missing signature value.");
        byte[] result=new byte[next.End-next.Start]; Buffer.BlockCopy(bytes,next.Start,result,0,result.Length); return result;
    }
    public static Dictionary<string,object> Verify(string file) {
        byte[] encoded=Embedded(System.IO.File.ReadAllBytes(file));
        SignedCms cms=new SignedCms(); cms.Decode(encoded);
        Require(cms.ContentInfo.ContentType.Value == "1.3.6.1.4.1.311.2.1.4" && cms.SignerInfos.Count == 1, "Unsupported Authenticode message.");
        cms.CheckSignature(true);
        SignerInfo signer=cms.SignerInfos[0];
        Require(signer.Certificate != null && signer.DigestAlgorithm.Value == Sha256, "Missing signer or non-SHA256 signature.");
        VerifySubject(file, cms.ContentInfo.Content);
        string time=VerifyTimestamp(signer, ExtractSignature(encoded));
        DateTime stamped=DateTime.Parse(time).ToUniversalTime();
        Require(stamped >= signer.Certificate.NotBefore.ToUniversalTime() && stamped <= signer.Certificate.NotAfter.ToUniversalTime(), "Timestamp is outside signer validity.");
        return new Dictionary<string,object> { {"thumbprint", signer.Certificate.Thumbprint}, {"subject", signer.Certificate.Subject},
            {"cryptographicSignature", "verified"}, {"peDigest", "sha256-verified"}, {"timestamp", "rfc3161-sha256-verified"},
            {"timestampTime", time}, {"tsaTrust", "not-verified"} };
    }
}
