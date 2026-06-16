export class PromptGuard {
  private patterns: RegExp[] = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /ignore\s+(all\s+)?prior\s+instructions/i,
    /you\s+are\s+now\s+a/i,
    /system\s*prompt\s*:/i,
    /forget\s+(everything|all|your\s+instructions)/i,
    /new\s+instructions?\s*:/i,
    /override\s+(your\s+)?(instructions|programming|directives)/i,
    /disregard\s+(all\s+)?(previous|prior|above)/i,
    /pretend\s+you\s+are/i,
    /act\s+as\s+(if\s+you\s+(are|were)|a\s+)/i,
    /jailbreak/i,
    /do\s+anything\s+now/i,
    /DAN\s+mode/i,
    /\[system\]/i,
    /\<\|im_start\|\>system/i,
  ];

  detect(text: string): { injectionDetected: boolean; patterns: string[] } {
    const matched: string[] = [];

    for (const pattern of this.patterns) {
      if (pattern.test(text)) {
        matched.push(pattern.source);
      }
    }

    return {
      injectionDetected: matched.length > 0,
      patterns: matched,
    };
  }
}
