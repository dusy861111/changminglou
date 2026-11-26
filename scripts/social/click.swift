// 系统级鼠标点击：用于封闭 Shadow DOM 的发布按钮。
// 编译：swiftc -O scripts/social/click.swift -o ~/bin/click
// 用法：click <x> <y>
import Cocoa

let args = CommandLine.arguments
guard args.count >= 3,
      let x = Double(args[1]),
      let y = Double(args[2]) else {
    FileHandle.standardError.write("usage: click <x> <y>\n".data(using: .utf8)!)
    exit(2)
}

let point = CGPoint(x: x, y: y)
let source = CGEventSource(stateID: .hidSystemState)

CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
        mouseCursorPosition: point, mouseButton: .left)?
    .post(tap: .cghidEventTap)
usleep(150_000)

CGEvent(mouseEventSource: source, mouseType: .leftMouseDown,
        mouseCursorPosition: point, mouseButton: .left)?
    .post(tap: .cghidEventTap)
usleep(60_000)

CGEvent(mouseEventSource: source, mouseType: .leftMouseUp,
        mouseCursorPosition: point, mouseButton: .left)?
    .post(tap: .cghidEventTap)
