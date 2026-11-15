Option Explicit
Dim files, shell, root, node, folder, result, command, code, stream, message, action
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
If WScript.Arguments.Count <> 1 Then WScript.Quit 1
action = WScript.Arguments(0)
If action <> "start" And action <> "stop" And action <> "status" Then WScript.Quit 1
shell.CurrentDirectory = root
folder = root & "\.cache"
If Not files.FolderExists(folder) Then files.CreateFolder folder
folder = folder & "\background"
If Not files.FolderExists(folder) Then files.CreateFolder folder
result = folder & "\" & files.GetTempName
node = root & "\node.exe"
If Not files.FileExists(node) Then node = "node.exe"
command = Quote(node) & " " & Quote(root & "\scripts\background-server.mjs") & " " & action & " --result " & Quote(result)
On Error Resume Next
code = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    MsgBox "Unable to start Node.js. Install Node.js 24.22.1+ or use the Windows runtime package.", 16, "Xingshiji"
    WScript.Quit 1
End If
On Error GoTo 0
If files.FileExists(result) Then
    Set stream = files.OpenTextFile(result, 1, False, -1)
    message = stream.ReadAll
    stream.Close
    files.DeleteFile result
Else
    message = "The controller did not return a result. Check Node.js and the installation files."
End If
If code = 0 Then
    MsgBox message, 64, "Xingshiji"
Else
    MsgBox message, 16, "Xingshiji"
End If
WScript.Quit code

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
