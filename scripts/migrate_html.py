import os
import re

def main():
    with open('web/index.html', 'r', encoding='utf-8') as f:
        legacy_html = f.read()

    # We need to extract screens using regex
    # The screens are wrapped like <div x-show="activePage === 'page_name'" ...> ... </div>
    # But because they contain nested divs, regex is tricky. 
    # Let's use string finding to extract based on known boundaries.
    
    # We will just write a simple script that generates the new HTML and we will manually fix up the rest if needed.
    
    with open('stitch_exports/dashboard.html', 'r', encoding='utf-8') as f:
        stitch_dash = f.read()
    with open('stitch_exports/investments.html', 'r', encoding='utf-8') as f:
        stitch_inv = f.read()
    with open('stitch_exports/import.html', 'r', encoding='utf-8') as f:
        stitch_imp = f.read()
    with open('stitch_exports/tax_summary.html', 'r', encoding='utf-8') as f:
        stitch_tax = f.read()

    # Extract Head from Stitch
    head_start = stitch_dash.find('<head>') + 6
    head_end = stitch_dash.find('</head>')
    stitch_head = stitch_dash[head_start:head_end]

    # Extract Body classes
    body_match = re.search(r'<body class="(.*?)"', stitch_dash)
    stitch_body_class = body_match.group(1) if body_match else ""

    # Extract TopAppBar
    header_start = stitch_dash.find('<header')
    header_end = stitch_dash.find('</header>') + 9
    stitch_header = stitch_dash[header_start:header_end]

    # Extract FAB
    fab_start = stitch_dash.find('<!-- FAB -->')
    fab_end = stitch_dash.find('</button>', fab_start) + 9
    if fab_start != -1:
        stitch_fab = stitch_dash[fab_start:fab_end]
    else:
        stitch_fab = ""

    # Extract BottomNavBar and Desktop Nav
    nav_start = stitch_dash.find('<!-- BottomNavBar -->')
    nav_end = stitch_dash.find('</body>')
    stitch_nav = stitch_dash[nav_start:nav_end]

    # Extract Main content of Dashboard
    main_start = stitch_dash.find('<main')
    main_end = stitch_dash.find('</main>') + 7
    dash_main = stitch_dash[main_start:main_end].replace('<main', '<main x-show="activePage === \'home\'"')

    # Extract Main content of Investments
    main_start = stitch_inv.find('<main')
    main_end = stitch_inv.find('</main>') + 7
    inv_main = stitch_inv[main_start:main_end].replace('<main', '<main x-show="activePage === \'investments\'" x-cloak')

    # Extract Main content of Import
    main_start = stitch_imp.find('<main')
    main_end = stitch_imp.find('</main>') + 7
    imp_main = stitch_imp[main_start:main_end].replace('<main', '<main x-show="activePage === \'import\'" x-cloak')

    # Extract Main content of Tax
    main_start = stitch_tax.find('<main')
    main_end = stitch_tax.find('</main>') + 7
    tax_main = stitch_tax[main_start:main_end].replace('<main', '<main x-show="activePage === \'tax\'" x-cloak')

    # Read legacy head scripts
    legacy_head_start = legacy_html.find('<!-- Chart.js -->')
    legacy_head_end = legacy_html.find('</head>')
    legacy_scripts = legacy_html[legacy_head_start:legacy_head_end]

    # The new head will be Stitch head + legacy scripts
    new_head = stitch_head + "\n" + legacy_scripts

    # Now let's extract legacy screens (Portfolio, Cashflow, Pension, etc.)
    # We will do this by looking for '<!-- ┌──────────────────────────────────────────────┐ -->' blocks
    blocks = legacy_html.split('<!-- ┌──────────────────────────────────────────────┐ -->')
    legacy_screens = []
    for block in blocks:
        if 'activePage === \'home\'' in block or 'activePage === \'investments\'' in block or 'activePage === \'import\'' in block or 'activePage === \'tax\'' in block:
            continue
        if 'activePage ===' in block:
            legacy_screens.append('<!-- ┌──────────────────────────────────────────────┐ -->' + block)

    legacy_screens_html = ''.join(legacy_screens)
    
    # Remove closing div/main tags that might be unbalanced at the end of legacy_screens
    # This is a bit hacky, so we will manually clean up the HTML afterwards.

    # Build New HTML
    new_html = f"""<!doctype html>
<html lang="en">
<head>
{new_head}
</head>
<body class="{stitch_body_class}" x-data="appData" x-cloak>

{stitch_header}

{dash_main}

{inv_main}

{imp_main}

{tax_main}

<main class="flex-1 overflow-x-hidden overflow-y-auto pt-28 px-4 md:px-8 max-w-7xl mx-auto flex flex-col gap-8 pb-32">
{legacy_screens_html}
</main>

{stitch_fab}

{stitch_nav}

</body>
</html>
"""

    with open('web/index_new.html', 'w', encoding='utf-8') as f:
        f.write(new_html)
    
    print("Migrated HTML to web/index_new.html")

if __name__ == '__main__':
    main()
