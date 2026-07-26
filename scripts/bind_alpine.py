import re

def main():
    with open('web/index_new.html', 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. Bind Dashboard
    html = html.replace('₹8.42 Cr', '<span x-text="formatCurrency(netWorthTotal)"></span>')
    html = html.replace('₹2.4 L', '<span x-text="formatCurrency(monthlyInvestmentIncome)"></span>')
    html = html.replace('₹3.0 L', '<span x-text="formatCurrency(monthlyInvestmentIncome * 1.25)"></span>') # dummy target for now
    html = html.replace('width: 80%', ':style="\'width: \' + Math.min((monthlyInvestmentIncome / (monthlyInvestmentIncome * 1.25)) * 100, 100) + \'%\'"')
    
    # Dashboard asset categories
    html = html.replace('₹1.2 Cr', '<span x-text="formatCurrency(getAssetTotal(\'Bank FD\'))"></span>')
    html = html.replace('₹85 L', '<span x-text="formatCurrency(getAssetTotal(\'Bond\') + getAssetTotal(\'RBI Bond\'))"></span>')
    html = html.replace('₹3.4 Cr', '<span x-text="formatCurrency(getAssetTotal(\'Mutual Fund\'))"></span>')
    html = html.replace('₹2.1 Cr', '<span x-text="formatCurrency(getAssetTotal(\'Stock\'))"></span>')
    html = html.replace('₹87 L', '<span x-text="formatCurrency(getAssetTotal(\'Gold\'))"></span>')
    
    # 2. Bottom Nav Bar bindings
    nav_replacements = [
        ('<!-- Dashboard (Active) -->\n<button class="flex flex-col', '<!-- Dashboard -->\n<button @click="activePage = \'home\'" :class="activePage === \'home\' ? \'bg-primary-container text-on-primary-container -translate-y-2 shadow-[0_8px_16px_rgba(0,201,167,0.4),0_0_15px_rgba(0,201,167,0.2)] border-primary/50\' : \'text-on-surface-variant hover:text-[#d4af37] hover:-translate-y-2\'" class="flex flex-col'),
        ('<!-- Investments (Inactive) -->\n<button class="flex flex-col', '<!-- Investments -->\n<button @click="activePage = \'investments\'" :class="activePage === \'investments\' ? \'bg-primary-container text-on-primary-container -translate-y-2 shadow-[0_8px_16px_rgba(0,201,167,0.4),0_0_15px_rgba(0,201,167,0.2)] border-primary/50\' : \'text-on-surface-variant hover:text-[#d4af37] hover:-translate-y-2\'" class="flex flex-col'),
        ('<!-- Import (Inactive) -->\n<button class="flex flex-col', '<!-- Import -->\n<button @click="activePage = \'import\'" :class="activePage === \'import\' ? \'bg-primary-container text-on-primary-container -translate-y-2 shadow-[0_8px_16px_rgba(0,201,167,0.4),0_0_15px_rgba(0,201,167,0.2)] border-primary/50\' : \'text-on-surface-variant hover:text-[#d4af37] hover:-translate-y-2\'" class="flex flex-col'),
        ('<!-- Tax (Inactive) -->\n<button class="flex flex-col', '<!-- Tax -->\n<button @click="activePage = \'tax\'" :class="activePage === \'tax\' ? \'bg-primary-container text-on-primary-container -translate-y-2 shadow-[0_8px_16px_rgba(0,201,167,0.4),0_0_15px_rgba(0,201,167,0.2)] border-primary/50\' : \'text-on-surface-variant hover:text-[#d4af37] hover:-translate-y-2\'" class="flex flex-col'),
    ]
    for old, new in nav_replacements:
        html = html.replace(old, new)
        
    # FAB Binding (Let\'s bind it to open Add Investment modal or go to Investments page)
    html = html.replace('<!-- FAB -->\n<button', '<!-- FAB -->\n<button @click="activePage = \'investments\'"')
    
    # 3. Tax bindings
    html = html.replace('₹4.85 L', '<span x-text="formatCurrency(totalInterestIncome || 0)"></span>')
    html = html.replace('₹48,500', '<span x-text="formatCurrency(totalTds || 0)"></span>')
    html = html.replace('₹0', '<span x-text="formatCurrency(netTaxPayable || 0)"></span>')

    # We need to extract the Add Investment and Edit Investment form from the OLD Investments page and put it in the NEW investments page.
    # The Stitch investments page just has a static list. We need to replace the static list with Alpine x-for loop over investments.
    # We will do this manually by writing a replacement string.
    
    investments_list_stitch = """<!-- Item 1: Active/Pressed State (Level 2 Elevation) -->"""
    
    if investments_list_stitch in html:
        # We will replace the static items with an Alpine template
        # The list is inside <section class="flex flex-col gap-card-gap">
        pattern = re.compile(r'<!-- Item 1: Active/Pressed State.*?</section>', re.DOTALL)
        
        alpine_list = """
<template x-for="inv in investments" :key="inv.id">
    <div @click="openEditModal(inv)" class="bg-gradient-to-br from-[#1c2b3c] to-[#0d1b2a] p-[24px] rounded-xl cursor-pointer lift-card shadow-[0_12px_24px_rgba(0,0,0,0.5),0_4px_12px_rgba(0,0,0,0.2)] border border-white/5 relative overflow-hidden group hover:-translate-y-2 transition-transform">
        <div class="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none mix-blend-overlay"></div>
        <div class="flex justify-between items-start mb-4 relative z-10">
            <div class="flex flex-col gap-2">
                <div class="flex items-center gap-2">
                    <span class="bg-[#122131]/80 px-3 py-1 rounded-full font-label-caps text-label-caps text-on-surface-variant border border-outline-variant backdrop-blur-sm" x-text="inv.type"></span>
                    <h3 class="font-headline-md text-headline-md-mobile md:text-headline-md text-on-surface" x-text="inv.name"></h3>
                </div>
                <p class="font-body-md text-body-md text-on-surface-variant" x-text="(inv.issuer ? inv.issuer + ' • ' : '') + 'Matures ' + formatDate(inv.maturityDate)"></p>
            </div>
            <div class="flex flex-col items-end gap-1">
                <span class="font-headline-md text-headline-md-mobile md:text-headline-md text-on-background" x-text="formatCurrency(inv.amount)"></span>
                <div class="flex items-center gap-1 text-primary">
                    <span class="material-symbols-outlined text-sm">trending_up</span>
                    <span class="font-body-md text-body-md" x-text="inv.rate + '%'"></span>
                </div>
            </div>
        </div>
    </div>
</template>
<div x-show="investments.length === 0" class="text-center p-8 text-on-surface-variant">
    No investments found. Click + to add.
</div>
</section>
"""
        html = pattern.sub(alpine_list, html)

    # 4. Import Bindings
    html = html.replace('<!-- 3D Inset Drop Zone -->\n<div', '<!-- 3D Inset Drop Zone -->\n<div @click="$refs.fileInput.click()"')
    html = html.replace('<button class="px-6 py-2 rounded-lg border border-accent text-accent', '<button @click.stop="$refs.fileInput.click()" class="px-6 py-2 rounded-lg border border-accent text-accent')
    # Add hidden file input
    html = html.replace('<!-- Form Section -->', '<input type="file" x-ref="fileInput" @change="handleFileUpload" class="hidden" accept=".pdf" />\n<!-- Form Section -->')
    html = html.replace('id="doc-password" placeholder="Enter password" type="password"', 'id="doc-password" x-model="pdfPassword" placeholder="Enter password" type="password"')
    html = html.replace('<!-- Action Button -->\n<button', '<!-- Action Button -->\n<button @click="processStatement()"')

    # Re-insert the Edit / Add Investment Modal at the end of body
    # We will grab it from the original file later or just include it manually. Let's include the Add Investment Modal in HTML
    
    with open('web/index_new.html', 'w', encoding='utf-8') as f:
        f.write(html)
    
    print("Alpine bindings applied.")

if __name__ == '__main__':
    main()
