// Read-only Win32/CoreAudio observer. Interface order follows Windows SDK
// mmdeviceapi.h and Audiopolicy.h. It never changes input, devices or sessions.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class JarvisPiPresence {
 [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO {public uint cbSize; public uint dwTime;}
 [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO v);
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h, int n, StringBuilder b, int size, out int needed);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
 public static double IdleSeconds() {var v=new LASTINPUTINFO();v.cbSize=(uint)Marshal.SizeOf(v);if(!GetLastInputInfo(ref v))return double.PositiveInfinity;return unchecked((uint)Environment.TickCount-v.dwTime)/1000.0;}
 public static bool Unlocked() {var h=OpenInputDesktop(0,false,1);if(h==IntPtr.Zero)return false;try {var b=new StringBuilder(256);int n;return GetUserObjectInformation(h,2,b,512,out n)&&b.ToString()=="Default";}finally {CloseDesktop(h);}}
 static void Check(int result) {Marshal.ThrowExceptionForHR(result);}
 static void Release(object value) {if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
 public static uint[] CaptureProcesses() {
  object enumerator=null; IMMDeviceCollection devices=null; var owners=new HashSet<uint>();
  try {
   enumerator=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
   Check(((IMMDeviceEnumerator)enumerator).EnumAudioEndpoints(1,1,out devices));
   uint count; Check(devices.GetCount(out count));
   for(uint i=0;i<count;i++) {
    IMMDevice device=null; object manager=null; IAudioSessionEnumerator sessions=null;
    try {
     Check(devices.Item(i,out device));var iid=new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
     Check(device.Activate(ref iid,23,IntPtr.Zero,out manager));
     Check(((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions));int n;Check(sessions.GetCount(out n));
     for(int j=0;j<n;j++) {
      IAudioSessionControl2 control=null;
      try {Check(sessions.GetSession(j,out control));int state;Check(control.GetState(out state));if(state==1){uint pid;Check(control.GetProcessId(out pid));owners.Add(pid);}}
      finally {Release(control);}
     }
    } finally {Release(sessions);Release(manager);Release(device);}
   }
   var result=new uint[owners.Count];owners.CopyTo(result);return result;
  } finally {Release(devices);Release(enumerator);}
 }

 [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
  [PreserveSig]int EnumAudioEndpoints(int flow,uint state,out IMMDeviceCollection devices);
 }
 [ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceCollection {
  [PreserveSig]int GetCount(out uint count); [PreserveSig]int Item(uint index,out IMMDevice device);
 }
 [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
  [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object value);
 }
 [ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionManager2 {
  [PreserveSig]int GetAudioSessionControl(IntPtr guid,uint flags,out IntPtr value);
  [PreserveSig]int GetSimpleAudioVolume(IntPtr guid,uint flags,out IntPtr value);
  [PreserveSig]int GetSessionEnumerator(out IAudioSessionEnumerator value);
 }
 [ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionEnumerator {
  [PreserveSig]int GetCount(out int count); [PreserveSig]int GetSession(int index,out IAudioSessionControl2 control);
 }
 [ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl2 {
  [PreserveSig]int GetState(out int state);
  [PreserveSig]int GetDisplayName(out IntPtr name);
  [PreserveSig]int SetDisplayName(IntPtr name,IntPtr context);
  [PreserveSig]int GetIconPath(out IntPtr name);
  [PreserveSig]int SetIconPath(IntPtr name,IntPtr context);
  [PreserveSig]int GetGroupingParam(out Guid value);
  [PreserveSig]int SetGroupingParam(IntPtr value,IntPtr context);
  [PreserveSig]int RegisterAudioSessionNotification(IntPtr value);
  [PreserveSig]int UnregisterAudioSessionNotification(IntPtr value);
  [PreserveSig]int GetSessionIdentifier(out IntPtr value);
  [PreserveSig]int GetSessionInstanceIdentifier(out IntPtr value);
  [PreserveSig]int GetProcessId(out uint pid);
 }
}
