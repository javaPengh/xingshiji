Option Explicit
Dim root, shell
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run "wscript.exe " & Chr(34) & root & "\scripts\server-manager.vbs" & Chr(34) & " start", 0, False
