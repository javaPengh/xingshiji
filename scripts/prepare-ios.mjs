import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'ios', 'App', 'App');
const plistPath = path.join(app, 'Info.plist');
if (!fs.existsSync(plistPath)) throw new Error('请先运行 npm run ios:add 创建 iOS 工程。');
let plist = fs.readFileSync(plistPath, 'utf8');
const permissions = {
  NSMotionUsageDescription: '读取 iPhone 当天步数，自动保存到你的日记。',
  NSCameraUsageDescription: '拍摄你要记录的餐食照片，由你选择后分析并保存。',
  NSPhotoLibraryUsageDescription: '选择餐食照片，用于分析食物和记录饮食。',
  NSPhotoLibraryAddUsageDescription: '在你主动保存照片时写入相册。',
  NSLocalNetworkUsageDescription: '连接你的电脑上的日记服务，读取和保存饮食记录。',
};
for (const [key, description] of Object.entries(permissions)) {
  if (!plist.includes(`<key>${key}</key>`)) plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t<string>${description}</string>\n</dict>\n</plist>\n`);
}
// Keep transport security enabled. Phone connections use trusted HTTPS; no blanket ATS exceptions.
fs.writeFileSync(plistPath, plist);
const privacy = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>NSPrivacyTracking</key><false/>
<key>NSPrivacyAccessedAPITypes</key><array><dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string><key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array></dict></array>
</dict></plist>`;
fs.writeFileSync(path.join(app, 'PrivacyInfo.xcprivacy'), privacy);
const projectPath = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
let project = fs.readFileSync(projectPath, 'utf8');
if (!project.includes('PrivacyInfo.xcprivacy')) {
  const fileId = 'A1B2C3D4E5F60718293A4B5C';
  const buildId = 'A1B2C3D4E5F60718293A4B5D';
  project = project.replace('/* Begin PBXBuildFile section */', `/* Begin PBXBuildFile section */\n\t\t${buildId} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${fileId} /* PrivacyInfo.xcprivacy */; };`);
  project = project.replace('/* Begin PBXFileReference section */', `/* Begin PBXFileReference section */\n\t\t${fileId} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`);
  project = project.replace(/(\s+504EC3131FED79650016851F \/\* Info.plist \*\/,)/, `$1\n\t\t\t\t${fileId} /* PrivacyInfo.xcprivacy */,`);
  project = project.replace(/(\s+504EC30F1FED79650016851F \/\* Assets.xcassets in Resources \*\/,)/, `$1\n\t\t\t\t${buildId} /* PrivacyInfo.xcprivacy in Resources */,`);
  if (!project.includes(`${buildId} /* PrivacyInfo.xcprivacy in Resources */,`)) throw new Error('iOS 资源结构有变化，请检查隐私清单的资源引用。');
  fs.writeFileSync(projectPath, project);
}
const icon = path.join(root, 'PWA', 'icons', 'icon-1024.png');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(app, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
console.log('iOS camera/photo/local-network descriptions, privacy manifest and app icon prepared. macOS compilation remains to be verified.');

let nativeProject=fs.readFileSync(projectPath,'utf8');
if(!nativeProject.includes('OfflineStoragePlugin.swift')){
  const fileId='F4A5B6C7D8E901234567890A',buildId='F4A5B6C7D8E901234567890B';
  nativeProject=nativeProject.replace('/* Begin PBXBuildFile section */',`/* Begin PBXBuildFile section */\n\t\t${buildId} /* OfflineStoragePlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${fileId} /* OfflineStoragePlugin.swift */; };`);
  nativeProject=nativeProject.replace('/* Begin PBXFileReference section */',`/* Begin PBXFileReference section */\n\t\t${fileId} /* OfflineStoragePlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = OfflineStoragePlugin.swift; sourceTree = "<group>"; };`);
  nativeProject=nativeProject.replace('504EC3071FED79650016851F /* AppDelegate.swift */,',`504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${fileId} /* OfflineStoragePlugin.swift */,`);
  nativeProject=nativeProject.replace('504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',`504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\t${buildId} /* OfflineStoragePlugin.swift in Sources */,`);
  if(!nativeProject.includes(`${buildId} /* OfflineStoragePlugin.swift in Sources */,`))throw new Error('SQLite plugin not in Sources');
  fs.writeFileSync(projectPath,nativeProject);
}
const storyboardPath=path.join(app,'Base.lproj','Main.storyboard');
fs.writeFileSync(storyboardPath,fs.readFileSync(storyboardPath,'utf8').replace('customClass="CAPBridgeViewController" customModule="Capacitor"','customClass="LocalBridgeViewController" customModule="App"'));
// iOS uses the scene's programmatic root instead of the storyboard root.
// Both entry points must register the SQLite/Keychain bridge.
const scenePath=path.join(app,'SceneDelegate.swift');
let scene=fs.readFileSync(scenePath,'utf8').replace('window?.rootViewController = CAPBridgeViewController()','window?.rootViewController = LocalBridgeViewController()');
if(!scene.includes('window?.rootViewController = LocalBridgeViewController()'))throw new Error('iOS scene entry must use the local-storage bridge.');
fs.writeFileSync(scenePath,scene);

let motionProject=fs.readFileSync(projectPath,'utf8');
if(!motionProject.includes('PedometerPlugin.swift')){
 const fileId='F4A5B6C7D8E901234567890C',buildId='F4A5B6C7D8E901234567890D';
 motionProject=motionProject.replace('/* Begin PBXBuildFile section */',`/* Begin PBXBuildFile section */\n\t\t${buildId} /* PedometerPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${fileId} /* PedometerPlugin.swift */; };`);
 motionProject=motionProject.replace('/* Begin PBXFileReference section */',`/* Begin PBXFileReference section */\n\t\t${fileId} /* PedometerPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PedometerPlugin.swift; sourceTree = "<group>"; };`);
 motionProject=motionProject.replace('504EC3071FED79650016851F /* AppDelegate.swift */,',`504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${fileId} /* PedometerPlugin.swift */,`);
 motionProject=motionProject.replace('504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',`504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\t${buildId} /* PedometerPlugin.swift in Sources */,`);
 if(!motionProject.includes(`${buildId} /* PedometerPlugin.swift in Sources */,`))throw Error('Pedometer plugin missing from build sources');
 fs.writeFileSync(projectPath,motionProject);
}
