import {Tree, Tag, Parser} from "lezer"

const none: readonly any[] = []

class TestSpec {
  constructor(readonly tag: string,
              readonly children: readonly TestSpec[] = none) {}

  static parse(spec: string): readonly TestSpec[] {
    let pos = 0, tok = "sof", value = ""
    function err(): never {
      throw new SyntaxError("Invalid test spec: " + spec)
    }
    function next() {
      while (pos < spec.length && /\s/.test(spec.charAt(pos))) pos++
      if (pos == spec.length) return tok = "eof"
      let next = spec.charAt(pos++)
      if (/[(),]/.test(next)) return tok = next
      if (/[^(),\s]/.test(next)) {
        let tag = /^([^(),\s"]|"([^"]|\\.)*")+/.exec(spec.slice(pos - 1))
        value = tag![0]
        pos += tag![0].length - 1
        return tok = "tag"
      }
      return err()
    }
    next()
    function parseSeq() {
      let seq = []
      while (tok != "eof" && tok != ")") {
        seq.push(parse())
        if (tok == ",") next()
      }
      return seq
    }
    function parse() {
      if (tok != "tag") err()
      let tag = value, children = none
      next()
      if (tok == "(") {
        next()
        children = parseSeq()
        // @ts-ignore TypeScript doesn't understand that `next` may have mutated `tok` (#9998)
        if (tok != ")") err()
        next()
      }
      return new TestSpec(tag, children)
    }
    let result = parseSeq()
    if (tok != "eof") err()
    return result
  }
}

function defaultIgnore(tag: Tag) {
  return tag.has("punctuation")
}

export function testTree(tree: Tree, expect: string, mayIgnore = defaultIgnore) {
  let specs = TestSpec.parse(expect)
  let stack = [specs], pos = [0]
  tree.iterate(0, tree.length, tag => {
    let last = stack.length - 1, index = pos[last], seq = stack[last]
    if (index < seq.length && tag.tag.indexOf(seq[index].tag) == 0) {
      pos.push(0)
      stack.push(seq[index].children)
      return undefined
    } else if (mayIgnore(tag)) {
      return false
    } else {
      let parent = last > 0 ? stack[last - 1][pos[last - 1]].tag : "tree"
      let after = index < pos[last] ? `end of ${parent}` : seq[index].tag + (parent == "tree" ? "" : " in " + parent)
      throw new Error(`Expected ${after}, got ${tag.tag}`)
    }
  }, (tag) => {
    let last = stack.length - 1, index = pos[last], seq = stack[last]
    if (index < seq.length) throw new Error(`Unexpected end of ${tag.tag}. Expected ${seq.slice(index).map(s => s.tag)}.`)
    pos.pop()
    stack.pop()
    pos[last - 1]++
  })
  if (pos[0] != specs.length) throw new Error(`Unexpected end of tree. Expected ${stack[0].slice(pos[0]).map(s => s.tag)}.`)
}

export function fileTests(file: string, fileName: string, mayIgnore = defaultIgnore) {
  let caseExpr = /\s*#\s*(.*)\n([^]*?)==+>([^]*?)\n+(?=#|$)/gy
  let tests: {name: string, run(parser: Parser): void}[] = []
  for (;;) {
    let m = caseExpr.exec(file)
    if (!m) throw new Error("Unexpected file format in " + fileName)
    let text = m[2].trim(), expected = m[3]
    tests.push({
      name: m[1],
      run(parser: Parser) {
        let strict = expected.indexOf("⚠") < 0
        testTree(parser.parse(text, {strict}), expected, mayIgnore)
      }
    })
    if (m.index + m[0].length == file.length) break
  }
  return tests
}